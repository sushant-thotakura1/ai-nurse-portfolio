import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  CircularProgress,
  Alert,
  Pagination,
} from '@mui/material';
import { documentsApi, DocumentChunk } from '../services/documentsApi';

const PAGE_SIZE = 20;

interface DocumentChunksDialogProps {
  open: boolean;
  documentId: string | null;
  documentTitle: string;
  onClose: () => void;
}

export default function DocumentChunksDialog({
  open,
  documentId,
  documentTitle,
  onClose,
}: DocumentChunksDialogProps) {
  const [chunks, setChunks] = useState<DocumentChunk[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to page 1 and clear any stale chunk data whenever the dialog is opened
  // for a (possibly new) document, so we never show one document's chunks under
  // another document's title during the fetch.
  useEffect(() => {
    if (open) {
      setPage(1);
      setChunks([]);
      setTotal(0);
      setError(null);
    }
  }, [open, documentId]);

  useEffect(() => {
    if (!open || !documentId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    documentsApi
      .getChunks(documentId, page, PAGE_SIZE)
      .then((response) => {
        if (cancelled) return;
        setChunks(response.data.data.chunks);
        setTotal(response.data.data.total);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Failed to load document chunks');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, documentId, page]);

  const pageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Chunks — {documentTitle}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 300 }}>
        {loading ? (
          <Box display="flex" justifyContent="center" mt={4}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : total === 0 ? (
          <Typography color="text.secondary">No chunks indexed for this document.</Typography>
        ) : (
          chunks.map((chunk) => (
            <Box
              key={chunk.chunkIndex}
              sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}
            >
              <Typography variant="caption" color="text.secondary">
                Chunk {chunk.chunkIndex + 1} — {chunk.characterCount} characters
              </Typography>
              <Typography
                component="pre"
                variant="body2"
                sx={{
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  mt: 1,
                }}
              >
                {chunk.chunkText}
              </Typography>
            </Box>
          ))
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: pageCount > 1 ? 'space-between' : 'flex-end', px: 3, pb: 2 }}>
        {pageCount > 1 && (
          <Pagination count={pageCount} page={page} onChange={(_, value) => setPage(value)} size="small" />
        )}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
