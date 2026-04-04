import io
import fitz  # pymupdf
from docx import Document


def parse_pdf(content: bytes) -> str:
    doc = fitz.open(stream=content, filetype="pdf")
    text = []
    for page in doc:
        text.append(page.get_text())
    doc.close()
    return "\n\n".join(text).strip()


def parse_docx(content: bytes) -> str:
    doc = Document(io.BytesIO(content))
    text = []
    for para in doc.paragraphs:
        if para.text.strip():
            text.append(para.text)
    return "\n\n".join(text).strip()


def parse_txt(content: bytes) -> str:
    return content.decode("utf-8", errors="replace").strip()


def parse_md(content: bytes) -> str:
    return content.decode("utf-8", errors="replace").strip()


PARSERS = {
    "application/pdf": parse_pdf,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": parse_docx,
    "text/plain": parse_txt,
    "text/markdown": parse_md,
}

EXTENSION_MAP = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".md": "text/markdown",
}


def parse_file(content: bytes, filename: str) -> str:
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    mime = EXTENSION_MAP.get(ext)
    if not mime or mime not in PARSERS:
        raise ValueError(f"Unsupported file type: {ext}")
    return PARSERS[mime](content)
