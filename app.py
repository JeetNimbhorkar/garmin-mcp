"""Authenticated HTTPS gateway for an official-API Garmin MCP server.

Deploy behind Koyeb TLS. ChatGPT connects to /mcp/<random access token>.
The upstream MCP service is bound to loopback and is never publicly reachable.
"""
import asyncio
import hmac
import logging
import os
from contextlib import suppress

import aiohttp
from aiohttp import web

HOST = '0.0.0.0'
PORT = int(os.getenv('PORT', '8000'))
UPSTREAM_PORT = 8491
UPSTREAM = f'http://127.0.0.1:{UPSTREAM_PORT}/mcp'
TOKEN = os.environ.get('MCP_ACCESS_TOKEN', '')
GARMIN_KEY = os.environ.get('GARMIN_PERSONAL_API_KEY', '')
MAX_BODY = 16 * 1024 * 1024
HOP_HEADERS = {'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
               'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length'}
LOG = logging.getLogger('garmin-gateway')


def check_configuration():
    if len(TOKEN) < 32 or not GARMIN_KEY:
        raise RuntimeError('Set GARMIN_PERSONAL_API_KEY and a random MCP_ACCESS_TOKEN of >=32 characters')
    if '/' in TOKEN or '?' in TOKEN or '#' in TOKEN:
        raise RuntimeError('MCP_ACCESS_TOKEN must be URL-safe (generate via secrets.token_urlsafe)')


async def health(_request):
    return web.json_response({'status': 'ok'})


async def proxy(request):
    if not hmac.compare_digest(request.match_info['secret'], TOKEN):
        raise web.HTTPNotFound()
    if request.content_length is not None and request.content_length > MAX_BODY:
        raise web.HTTPRequestEntityTooLarge(max_size=MAX_BODY, actual_size=request.content_length)
    body = await request.read()
    if len(body) > MAX_BODY:
        raise web.HTTPRequestEntityTooLarge(max_size=MAX_BODY, actual_size=len(body))

    headers = {key: value for key, value in request.headers.items()
               if key.lower() not in HOP_HEADERS and key.lower() != 'authorization'}
    # Force the internal Host and do not propagate external secrets or Origin.
    headers.pop('Origin', None)
    headers.pop('origin', None)
    headers['Host'] = f'127.0.0.1:{UPSTREAM_PORT}'
    target = UPSTREAM + (('?' + request.query_string) if request.query_string else '')
    session = request.app['http_client']
    try:
        async with session.request(request.method, target, data=body, headers=headers,
                                   allow_redirects=False) as response:
            outgoing = {key: value for key, value in response.headers.items()
                        if key.lower() not in HOP_HEADERS and key.lower() not in {'content-encoding', 'content-length'}}
            # HTTP streaming is required for MCP's SSE responses.
            stream = web.StreamResponse(status=response.status, headers=outgoing)
            await stream.prepare(request)
            async for chunk in response.content.iter_chunked(8192):
                await stream.write(chunk)
            await stream.write_eof()
            return stream
    except aiohttp.ClientError:
        LOG.warning('Internal MCP request failed')
        raise web.HTTPBadGateway(text='Garmin MCP unavailable')
    except (ConnectionResetError, asyncio.CancelledError):
        raise


async def start_upstream(app):
    # The packaged CLI is the canonical, documented entry point.
    args = ['garmin-personal-mcp', '--http', '--host', '127.0.0.1', '--port', str(UPSTREAM_PORT)]
    LOG.info('Starting read-only Garmin Personal MCP on loopback')
    process = await asyncio.create_subprocess_exec(*args)
    app['mcp_process'] = process
    for _ in range(80):
        if process.returncode is not None:
            raise RuntimeError(f'Garmin MCP exited during startup (code {process.returncode})')
        try:
            _, writer = await asyncio.open_connection('127.0.0.1', UPSTREAM_PORT)
            writer.close()
            await writer.wait_closed()
            break
        except OSError:
            await asyncio.sleep(.25)
    else:
        raise RuntimeError('Garmin MCP failed to start listening')
    app['http_client'] = aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=None, sock_connect=20, sock_read=None),
        auto_decompress=True)
    LOG.info('Gateway ready')


async def stop_upstream(app):
    if 'http_client' in app:
        await app['http_client'].close()
    process = app.get('mcp_process')
    if process and process.returncode is None:
        process.terminate()
        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(process.wait(), 5)
        if process.returncode is None:
            process.kill()
            await process.wait()


def create_app():
    check_configuration()
    app = web.Application(client_max_size=MAX_BODY)
    app.router.add_get('/health', health)
    app.router.add_route('*', '/mcp/{secret}', proxy)
    app.router.add_route('*', '/mcp/{secret}/', proxy)
    app.on_startup.append(start_upstream)
    app.on_cleanup.append(stop_upstream)
    return app


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    # Disable access logs so a token embedded in the path does not leak into logs.
    web.run_app(create_app(), host=HOST, port=PORT, access_log=None)
