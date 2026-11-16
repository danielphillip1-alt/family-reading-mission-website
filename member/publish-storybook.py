"""Merge 12 approved PDFs, upload them, and activate one storybook language."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlencode
from urllib.request import Request, urlopen

CHUNK = 524288


def publish(origin, language, books, token):
    if len(books) != 12 or len(dict(books)) != 12:
        raise ValueError("Pass 12 distinct slug=PDF arguments in reading order")

    def post(path, data):
        req = Request(origin.rstrip("/") + "/api/admin/storybook/" + path, data=data,
                      headers={"Authorization": "Bearer " + token}, method="POST")
        with urlopen(req, timeout=180) as result:
            return result.read()

    def upload(slug, path):
        def action(name, data, **extra):
            query = urlencode(dict(slug=slug, language=language, action=name, **extra))
            return post("pdf?" + query, data)

        with path.open("rb") as stream:
            checksum = hashlib.file_digest(stream, "sha256").hexdigest()
        action("start", urlencode(dict(size=path.stat().st_size, sha256=checksum)).encode())
        with path.open("rb") as stream:
            for part, block in enumerate(iter(lambda: stream.read(CHUNK), b"")):
                action("part", block, part=part)
        action("approve", b"")

    with tempfile.TemporaryDirectory() as directory:
        combined = Path(directory) / "collection.pdf"
        subprocess.run(["pdfunite", *(str(p.resolve()) for _, p in books), str(combined)], check=True)
        for slug, path in books:
            upload(slug, path)
        upload("aom-storybook-collection", combined)
    message = post("edition", urlencode([("language", language), *(("slug", s) for s, _ in books)]).encode())
    print(message.decode())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", default="https://authors-on-a-mission-members.onrender.com")
    parser.add_argument("language", choices=["en", "de", "pt-PT", "tr"])
    parser.add_argument("book", nargs=12, metavar="slug=PDF")
    args = parser.parse_args()
    books = [(slug, Path(path)) for slug, path in (item.split("=", 1) for item in args.book)]
    publish(args.origin, args.language, books, os.environ["AOM_ADMIN_API_TOKEN"])
