"""Download files from Supabase Storage.

Uses the service-role client, so RLS is bypassed. The caller is responsible
for verifying the requesting user owns the document (Phase 2's indexer
loads the document row from `documents` and trusts user_id from there).
"""

from ..config import get_settings
from ..supabase_client import get_supabase


# Known buckets that may appear as the optional "<bucket>:<path>" prefix
# in documents.storage_path. Older rows were saved with this prefix while
# newer ones (see backend/functions/documents-upload.js) store a plain path
# and rely on the bucket coming from the RAG_STORAGE_BUCKET env var.
_KNOWN_BUCKETS = {"course-uploads", "course-documents", "chat-attachments"}


def _resolve_bucket_and_path(storage_path: str, default_bucket: str) -> tuple[str, str]:
    """Split `<bucket>:<path>` if present, else use the default bucket."""
    if ":" in storage_path:
        head, rest = storage_path.split(":", 1)
        if head in _KNOWN_BUCKETS and rest:
            return head, rest
    return default_bucket, storage_path


def download_document_bytes(storage_path: str, bucket: str | None = None) -> bytes:
    """Return raw PDF bytes for a document at the given storage path.

    storage_path is what's stored in `documents.storage_path` — typically
    `<user_id>/<course_id>/<file_name>`. We pass it through verbatim.
    """
    if not storage_path:
        raise ValueError("storage_path is required")

    sb = get_supabase()
    default_bucket = bucket or get_settings().rag_storage_bucket
    resolved_bucket, resolved_path = _resolve_bucket_and_path(storage_path, default_bucket)
    return sb.storage.from_(resolved_bucket).download(resolved_path)
