// src/pages/superadmin/QRGenerator.jsx
import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import * as XLSX from 'xlsx';
import '../../styles/superadmin/QRGenerator.css';

function formatTimestamp(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function QRGenerator() {
  const [adminUsers, setAdminUsers] = useState([]);

  const [assignUserId, setAssignUserId] = useState('');
  const [quantity, setQuantity] = useState(10);
  const [serialDigits, setSerialDigits] = useState(4);
  const [serialPrefix, setSerialPrefix] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Only the batch just generated in this session is shown here — full
  // history of past batches now lives on the History Generated QR page.
  const [lastGeneratedBatch, setLastGeneratedBatch] = useState(null);

  useEffect(() => {
    apiFetch('/api/users')
      .then((res) => res.json())
      .then((data) => setAdminUsers(data.filter((u) => u.role === 'admin')))
      .catch((err) => console.error('Failed to load admin users:', err));
  }, []);

  // --- Excel export ------------------------------------------------------

  const exportToExcel = (codes, fileName) => {
    const rows = codes.map((qr) => ({
      'Serial Number': qr.serial_number,
      'QR Code': qr.qr_value,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'QR Codes');
    XLSX.writeFile(workbook, fileName);
  };

  // --- Generate ------------------------------------------------------------

  const handleGenerate = async (e) => {
    e.preventDefault();

    if (!assignUserId) {
      alert('Select which merchant these codes are for.');
      return;
    }

    // Company name is derived from the selected merchant's own name.
    const selectedMerchant = adminUsers.find((u) => u.user_id === assignUserId);
    const companyName = selectedMerchant?.name?.trim();
    if (!companyName) {
      alert('Could not determine a company name for the selected merchant.');
      return;
    }

    const count = Number(quantity);
    if (!count || count <= 0) {
      alert('Enter a valid quantity.');
      return;
    }

    setIsGenerating(true);
    try {
      const res = await apiFetch('/api/superadmin/qrcode/batches', {
        method: 'POST',
        body: JSON.stringify({
          company_name: companyName,
          assigned_user_id: assignUserId,
          quantity: count,
          serial_digits: Number(serialDigits),
          serial_prefix: serialPrefix.trim(),
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        alert(result.message || 'Could not generate batch.');
        return;
      }

      exportToExcel(result.codes, result.file_name);
      setLastGeneratedBatch({ ...result, assigned_user_name: companyName });

      setAssignUserId('');
      setQuantity(10);
    } catch (err) {
      alert('Could not reach server. Check it is running.');
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRedownload = async () => {
    if (!lastGeneratedBatch) return;
    try {
      const res = await apiFetch(`/api/superadmin/qrcode/batches/${lastGeneratedBatch.batch_id}/codes`);
      const codes = await res.json();
      exportToExcel(codes, lastGeneratedBatch.file_name);
    } catch (err) {
      alert('Could not reach server. Check it is running.');
      console.error(err);
    }
  };

  return (
    <div className="qr-generator">
      <section className="generate-section">
        <h2>Generate QR Codes</h2>
        <form className="generate-form" onSubmit={handleGenerate}>
          <div className="form-group">
            <label>For Merchant</label>
            <select
              value={assignUserId}
              onChange={(e) => setAssignUserId(e.target.value)}
            >
              <option value="">Select merchant</option>
              {adminUsers.map((u) => (
                <option key={u.user_id} value={u.user_id}>{u.name} ({u.email})</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Quantity</label>
            <input
              type="number"
              min="1"
              max="100000"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Serial Digits</label>
            <input
              type="number"
              min="4"
              max="10"
              value={serialDigits}
              onChange={(e) => setSerialDigits(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Serial Prefix (optional)</label>
            <input
              type="text"
              value={serialPrefix}
              onChange={(e) => setSerialPrefix(e.target.value)}
              placeholder="e.g. MX"
            />
          </div>

          <button type="submit" className="btn-primary" disabled={isGenerating}>
            {isGenerating ? 'Generating…' : 'Generate & Export'}
          </button>
        </form>
        <p className="section-hint">
          Serial numbering continues automatically per merchant — switching
          merchants starts a fresh count. Generating downloads an Excel file
          of the batch automatically. Looking for older batches? Check the
          History Generated QR page.
        </p>
      </section>

      {lastGeneratedBatch && (
        <section className="qr-list-section">
          <h2>Newly Generated Batch</h2>
          <table className="qr-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Merchant</th>
                <th>Quantity</th>
                <th>Serial Range</th>
                <th>Generated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="file-cell">{lastGeneratedBatch.file_name}</td>
                <td>{lastGeneratedBatch.assigned_user_name}</td>
                <td>{lastGeneratedBatch.quantity}</td>
                <td className="serial-cell">
                  {lastGeneratedBatch.serial_start} – {lastGeneratedBatch.serial_end}
                </td>
                <td>{formatTimestamp(lastGeneratedBatch.created_at)}</td>
                <td>
                  <button className="btn-download" onClick={handleRedownload}>
                    Download
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}