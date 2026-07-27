// src/pages/merchant/ApproveQrProduct.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/dateFormat';
import '../../styles/ApproveQrProduct.css';

export default function ApproveQrProduct() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const loadGroups = () => {
    setIsLoading(true);
    apiFetch('/api/qrcode/pending-approvals')
      .then((res) => res.json())
      .then((data) => setGroups(data))
      .catch((err) => {
        setErrorMessage('Could not reach server. Check it is running.');
        console.error(err);
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadGroups();
  }, []);

  return (
    <div className="listing-page">
      <div className="listing-page-header">
        <h2>Approve QR Product</h2>
        <p className="listing-breadcrumb">Product InfoCenter / Approve QR Product</p>
      </div>

      <div className="listing-card">
        <div className="detail-section-header">
          <ClipboardCheck size={18} />
          <h3>Pending Assignments</h3>
          <span className="variant-count-badge">{groups.length}</span>
        </div>

        {errorMessage && <p className="error-text">{errorMessage}</p>}

        {isLoading ? (
          <p className="empty-state">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="empty-state">No pending QR assignments right now.</p>
        ) : (
          <table className="products-flat-table">
            <thead>
              <tr>
                <th>Product Name</th>
                <th>SKU</th>
                <th>Pending Units</th>
                <th>Last Requested</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.variant_id}>
                  <td>{g.product_name}</td>
                  <td>
                    <span className="sku-badge">{g.sku}</span>
                  </td>
                  <td>
                    <span className="variant-count-badge">{g.pending_count}</span>
                  </td>
                  <td>{formatDateTime(g.last_requested_at)}</td>
                  <td>
                    <button
                      type="button"
                      className="product-link"
                      onClick={() => navigate(`/approve-qr/${g.variant_id}`)}
                    >
                      Review &rarr;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}