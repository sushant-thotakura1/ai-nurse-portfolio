import { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  CircularProgress,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  Snackbar,
} from '@mui/material';
import {
  Upload as UploadIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckCircleIcon,
  HorizontalRule as RemoveIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import { documentsApi, TenantDocument, UploadDocumentInput } from '../services/documentsApi';
import DocumentChunksDialog from '../components/DocumentChunksDialog';

function getFileTypeChip(contentType: string) {
  if (contentType.includes('pdf')) return { label: 'PDF', color: 'error' as const };
  if (contentType.includes('wordprocessingml') || contentType.includes('msword'))
    return { label: 'DOCX', color: 'info' as const };
  if (contentType.includes('csv')) return { label: 'CSV', color: 'success' as const };
  if (contentType.includes('spreadsheetml') || contentType.includes('excel'))
    return { label: 'XLSX', color: 'success' as const };
  if (contentType.includes('plain')) return { label: 'TXT', color: 'default' as const };
  if (contentType.includes('markdown')) return { label: 'MD', color: 'default' as const };
  return { label: contentType.split('/').pop()?.toUpperCase() ?? 'FILE', color: 'default' as const };
}

export default function Documents() {
  const [documents, setDocuments] = useState<TenantDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  // Upload dialog state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [keywords, setKeywords] = useState('');
  const [description, setDescription] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState<TenantDocument | null>(null);

  // Chunks dialog state
  const [chunksDialogDoc, setChunksDialogDoc] = useState<TenantDocument | null>(null);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const response = await documentsApi.list();
      setDocuments(response.data.data);
      setError(null);
    } catch {
      setError('Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (selected: File) => {
    setFile(selected);
    if (!title) {
      setTitle(selected.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileSelect(dropped);
  };

  const handleUploadClose = () => {
    setUploadOpen(false);
    setFile(null);
    setTitle('');
    setSummary('');
    setKeywords('');
    setDescription('');
    setUploadError(null);
    setUploading(false);
  };

  const handleUpload = async () => {
    if (!file || !title.trim() || !summary.trim()) {
      setUploadError('File, title, and summary are required');
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const input: UploadDocumentInput = {
        file,
        title: title.trim(),
        summary: summary.trim(),
        description: description.trim() || undefined,
        keywords: keywords.trim() || undefined,
      };
      const response = await documentsApi.upload(input);
      const doc = response.data.data;
      handleUploadClose();
      await fetchDocuments();
      setSnackbar(`Document uploaded — ${doc.embeddingsCount} chunks indexed`);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ??
        (err?.response?.status === 413
          ? 'File exceeds the 50 MB limit'
          : 'Upload failed. Please try again.');
      setUploadError(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!docToDelete) return;
    try {
      await documentsApi.delete(docToDelete.id);
      setDeleteOpen(false);
      setDocToDelete(null);
      await fetchDocuments();
      setSnackbar('Document deleted');
    } catch {
      setSnackbar('Failed to delete document');
    }
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5">Clinical Documents</Typography>
        <Button
          variant="contained"
          startIcon={<UploadIcon />}
          onClick={() => setUploadOpen(true)}
        >
          Upload Document
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Document table */}
      {loading ? (
        <Box display="flex" justifyContent="center" mt={4}>
          <CircularProgress />
        </Box>
      ) : documents.length === 0 ? (
        <Box sx={{ textAlign: 'center', mt: 6, color: 'text.secondary' }}>
          <Typography>
            No documents yet. Upload a clinical document to help the AI nurse answer patient questions.
          </Typography>
        </Box>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Title</TableCell>
                <TableCell>File Type</TableCell>
                <TableCell align="right">Chunks</TableCell>
                <TableCell align="center">Summary Indexed</TableCell>
                <TableCell>Uploaded</TableCell>
                <TableCell align="center">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {documents.map((doc) => {
                const chip = getFileTypeChip(doc.contentType);
                return (
                  <TableRow key={doc.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>{doc.title}</Typography>
                      {doc.description && (
                        <Typography variant="caption" color="text.secondary">{doc.description}</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip label={chip.label} color={chip.color} size="small" />
                    </TableCell>
                    <TableCell align="right">{doc.embeddingsCount}</TableCell>
                    <TableCell align="center">
                      {doc.hasSummaryEmbedding ? (
                        <Tooltip title="Summary embedded">
                          <CheckCircleIcon color="success" fontSize="small" />
                        </Tooltip>
                      ) : (
                        <Tooltip title="No summary">
                          <RemoveIcon color="disabled" fontSize="small" />
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell>
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="View chunks">
                        <IconButton
                          size="small"
                          onClick={() => setChunksDialogDoc(doc)}
                        >
                          <ViewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete document">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => { setDocToDelete(doc); setDeleteOpen(true); }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onClose={!uploading ? handleUploadClose : undefined} maxWidth="sm" fullWidth>
        <DialogTitle>Upload Clinical Document</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {uploadError && <Alert severity="error">{uploadError}</Alert>}

          <TextField
            label="Title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={uploading}
            fullWidth
          />

          <TextField
            label="Summary"
            required
            multiline
            minRows={2}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            helperText="Used to find this document when patients ask questions"
            disabled={uploading}
            fullWidth
          />

          <TextField
            label="Keywords"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            helperText="Optional — comma-separated: heart failure, discharge, medication"
            disabled={uploading}
            fullWidth
          />

          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            helperText="Internal note, not used for search"
            disabled={uploading}
            fullWidth
          />

          {/* File drop zone */}
          <Box
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            sx={{
              border: '2px dashed',
              borderColor: dragOver ? 'primary.main' : 'divider',
              borderRadius: 1,
              p: 3,
              textAlign: 'center',
              cursor: 'pointer',
              bgcolor: dragOver ? 'action.hover' : 'background.default',
              transition: 'all 0.2s',
            }}
          >
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept=".pdf,.docx,.doc,.csv,.xlsx,.xls,.txt,.md"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
              disabled={uploading}
            />
            {file ? (
              <Typography variant="body2" color="primary">{file.name}</Typography>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Drag & drop a file here, or click to browse
                <br />
                <Typography component="span" variant="caption">
                  PDF, DOCX, CSV, XLSX, TXT, MD — max 50 MB
                </Typography>
              </Typography>
            )}
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleUploadClose} disabled={uploading}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleUpload}
            disabled={uploading || !file}
            startIcon={uploading ? <CircularProgress size={16} /> : <UploadIcon />}
          >
            {uploading ? 'Uploading and processing…' : 'Upload'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Document</DialogTitle>
        <DialogContent>
          <Typography>
            Delete <strong>{docToDelete?.title}</strong>? This will permanently remove the document
            and all {docToDelete?.embeddingsCount} indexed chunks.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDeleteConfirm}>Delete</Button>
        </DialogActions>
      </Dialog>

      {/* Chunks dialog */}
      <DocumentChunksDialog
        open={!!chunksDialogDoc}
        documentId={chunksDialogDoc?.id ?? null}
        documentTitle={chunksDialogDoc?.title ?? ''}
        onClose={() => setChunksDialogDoc(null)}
      />

      {/* Success snackbar */}
      <Snackbar
        open={!!snackbar}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        message={snackbar}
      />
    </Box>
  );
}
