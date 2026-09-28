# -*- coding: utf-8 -*-
"""Learning from the phone, on the same wifi as the Mac.

A phone lets a web page use the microphone only over https, so `./run.sh
--phone` serves the app a second time, over https, on the local network: with a
certificate made once for this Mac (the phone asks once to trust it), and a
private link. Anyone else on the wifi who finds the port gets nothing without
the key in that link -- the app spends your OpenAI key, so it is not left open.
"""

import os
import secrets
import socket
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, ".phone")


def lan_ip():
    """This Mac's address on the local network."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("10.255.255.255", 1))        # no packet is sent; it only picks the interface
        return probe.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        probe.close()


def key():
    """The secret in the private link, made once and kept."""
    os.makedirs(DIR, exist_ok=True)
    path = os.path.join(DIR, "key")
    if not os.path.exists(path):
        with open(path, "w") as handle:
            handle.write(secrets.token_urlsafe(18))
        os.chmod(path, 0o600)
    with open(path) as handle:
        return handle.read().strip()


def certificate(ip):
    """(cert, key) files for https on this address, made with openssl if need be."""
    os.makedirs(DIR, exist_ok=True)
    cert, private = os.path.join(DIR, "cert-%s.pem" % ip), os.path.join(DIR, "key-%s.pem" % ip)
    if os.path.exists(cert) and os.path.exists(private):
        return cert, private
    base = ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", private, "-out", cert,
            "-days", "825", "-subj", "/CN=Chavruta"]
    for extra in (["-addext", "subjectAltName=IP:%s,DNS:localhost" % ip], []):
        try:
            subprocess.run(base + extra, check=True, capture_output=True, timeout=60)
            os.chmod(private, 0o600)
            return cert, private
        except (OSError, subprocess.SubprocessError):
            continue
    raise SystemExit("could not make a certificate: is openssl installed? (on a Mac it is, as /usr/bin/openssl)")
