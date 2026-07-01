#!/usr/bin/env python3
# CDN anti-hotlink (JA3/TLS parmak izi) aşımı: curl_cffi ile Chrome TLS taklidi.
# Kullanım: python3 cdn_fetch.py <url> <headers-json> [range]
# Gövdeyi stdout'a (binary) akıtır. 2xx değilse stderr'e "HTTP <code>" yazıp exit 43.
import sys, json

try:
    from curl_cffi import requests
except Exception as e:
    sys.stderr.write("curl_cffi import hatası: %s" % e)
    sys.exit(2)

def main():
    url = sys.argv[1]
    headers = json.loads(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else {}
    rng = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
    if rng:
        headers = dict(headers)
        headers["Range"] = rng
    try:
        r = requests.get(url, headers=headers, impersonate="chrome124",
                         stream=True, timeout=40, allow_redirects=True, verify=True)
    except Exception as e:
        sys.stderr.write("istek hatası: %s" % e)
        sys.exit(1)
    if r.status_code >= 400:
        sys.stderr.write("HTTP %s" % r.status_code)
        sys.exit(43)
    out = sys.stdout.buffer
    try:
        for chunk in r.iter_content(chunk_size=65536):
            if chunk:
                out.write(chunk)
        out.flush()
    except (BrokenPipeError, IOError):
        # oynatıcı bağlantıyı kapattı — sorun değil
        pass

if __name__ == "__main__":
    main()
