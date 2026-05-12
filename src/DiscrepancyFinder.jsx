import React, { useState, useRef, useEffect } from 'react';
import { Upload, AlertCircle, Info, Download, Play, RefreshCw, FileText, ShieldAlert, CheckCircle, CheckCircle2, Activity, DollarSign, FileWarning, Key } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Set PDF.js worker for Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const COMPLIANCE_RULES = [
  { id: 'CR-01', type: 'unbundling', code: '71046', conflicts: ['99233'], description: 'Chest X-ray (71046) should typically be bundled if billed alongside high-complexity E&M (99233) on the same date.' },
  { id: 'CR-02', type: 'upcoding', code: '99233', condition: 'consecutive_days', max_days: 1, description: 'High complexity subsequent hospital care (99233) rarely justified for multiple consecutive days. Downgrade to 99232 usually required.' },
  { id: 'CR-03', type: 'incorrect_units', medication: 'Zithromax', max_units_per_day: 1, description: 'Zithromax (Azithromycin) typical dosing is 1 unit per day. Verify total course units.' },
  { id: 'CR-04', type: 'missing_auth', code: '71250', description: 'CT Thorax (71250) requires prior authorization.' },
  { id: 'CR-05', type: 'duplicate', description: 'Check for identical line items billed on the same date without modifier 76.' },
  { id: 'CR-06', type: 'unbundling', code: '36415', description: 'Routine venipuncture (36415) is bundled into lab panels.' },
  { id: 'CR-07', type: 'anomaly', code: '99238', description: 'Hospital discharge day management (99238) cannot be billed with concurrent care on the same day.' },
  { id: 'CR-08', type: 'upcoding', code: '99285', description: 'Level 5 ER visit (99285) requires comprehensive history, exam, and high complexity decision making.' },
  { id: 'CR-09', type: 'incorrect_units', code: 'J-codes', description: 'Verify biologicals/drugs (J-codes) units against vial sizes to prevent waste billing.' },
  { id: 'CR-10', type: 'missing_auth', code: 'MRI', description: 'All non-emergent MRIs require prior authorization.' }
];

const mockSampleData = {
  encounter: {
    patient_id: "P-8472",
    facility: "General Hospital East",
    admission_date: "2023-10-12",
    discharge_date: "2023-10-15",
    drg_code: "194",
    primary_diagnosis_icd: "J18.9",
    attending_physician: "Dr. Sarah Jenkins",
    total_billed: 14850.00,
    insurance_adjustments: 2100.00,
    patient_responsibility: 0
  },
  line_items: [
    { cpt_code: "99223", description: "Initial hospital care, high complexity", units: 1, unit_rate: 350.00, billed_amount: 350.00, cms_expected_rate: 220.00, variance: 130.00, flagged: false },
    { cpt_code: "99233", description: "Subsequent hospital care, high complexity", units: 3, unit_rate: 280.00, billed_amount: 840.00, cms_expected_rate: 100.00, variance: 740.00, flagged: true },
    { cpt_code: "71046", description: "Radiologic examination, chest; 2 views", units: 1, unit_rate: 150.00, billed_amount: 150.00, cms_expected_rate: 45.00, variance: 105.00, flagged: true },
    { cpt_code: "96365", description: "Intravenous infusion, for therapy/diagnosis; initial", units: 2, unit_rate: 120.00, billed_amount: 240.00, cms_expected_rate: 75.00, variance: 165.00, flagged: true },
    { cpt_code: "J0456", description: "Azithromycin 500mg (Zithromax)", units: 6, unit_rate: 45.00, billed_amount: 270.00, cms_expected_rate: 15.00, variance: 255.00, flagged: true },
    { cpt_code: "71250", description: "Computed tomography, thorax; without contrast", units: 1, unit_rate: 850.00, billed_amount: 850.00, cms_expected_rate: 320.00, variance: 530.00, flagged: true },
    { cpt_code: "85025", description: "Complete CBC w/ auto diff", units: 1, unit_rate: 65.00, billed_amount: 65.00, cms_expected_rate: 11.00, variance: 54.00, flagged: false }
  ],
  discrepancies: [
    { severity: "critical", type: "unbundling", cpt_code: "71046", icd_code: "J18.9", description: "Chest X-ray (71046) billed separately alongside 99233 which includes imaging review.", cms_reference: "NCCI Policy Manual Chapter 9", billed_amount: 150.00, correct_amount: 0, estimated_recovery: 150.00, suggestion: "Bundle into 99233." },
    { severity: "critical", type: "upcoding", cpt_code: "99233", icd_code: "J18.9", description: "Billed 99233 for all 3 days. Day 1 justified, days 2-3 should be 99232 (moderate complexity).", cms_reference: "E&M Guidelines 2023", billed_amount: 840.00, correct_amount: 480.00, estimated_recovery: 360.00, suggestion: "Downgrade 2 units to 99232." },
    { severity: "warning", type: "duplicate", cpt_code: "96365", icd_code: "", description: "Initial IV administration billed twice on day 2. Only one 'initial' allowed per encounter.", cms_reference: "CPT Guidelines", billed_amount: 240.00, correct_amount: 120.00, estimated_recovery: 120.00, suggestion: "Remove duplicate charge." },
    { severity: "warning", type: "incorrect_units", cpt_code: "J0456", icd_code: "", description: "Zithromax 500mg billed as 6 units. Discharge summary indicates 3-day course = 3 units.", cms_reference: "Pharmacy Rx Log", billed_amount: 270.00, correct_amount: 135.00, estimated_recovery: 135.00, suggestion: "Reduce units to 3." },
    { severity: "info", type: "missing_auth", cpt_code: "71250", icd_code: "", description: "No pre-authorization code found on record for CT Thorax.", cms_reference: "Payer Policy", billed_amount: 850.00, correct_amount: 0, estimated_recovery: 850.00, suggestion: "Verify and attach Auth ID." }
  ],
  risk_score: 82,
  total_flagged_amount: 2350.00,
  estimated_total_recovery: 1615.00,
  summary: "High-risk claim identified. Multiple instances of upcoding and unbundling consistent with aggressive billing patterns. Immediate review recommended prior to payer submission."
};



export default function DiscrepancyFinder() {
  const [status, setStatus] = useState('idle'); // idle, loading, success, error
  const [data, setData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);


  const extractTextFromPDF = async (file) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += `Page ${i}:\n${pageText}\n\n`;
      }
      return fullText;
    } catch (err) {
      console.error("PDF Extraction error:", err);
      throw new Error("PDF Error: " + err.message);
    }
  };

  const processWithGemini = async (text) => {
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Server error (${response.status})`);
      }

      const result = await response.json();
      return result;
    } catch (err) {
      console.error(err);
      throw new Error(err.message || "Failed to process hospital bill.");
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.type !== 'application/pdf') {
      setErrorMsg("Please upload a PDF file.");
      return;
    }
    
    if (file.size > 20 * 1024 * 1024) {
      setErrorMsg("File exceeds 20MB limit.");
      return;
    }

    setStatus('loading');
    setErrorMsg('');
    
    try {
      const text = await extractTextFromPDF(file);
      if (text.trim().length < 50) {
        throw new Error("This appears to be a scanned bill without text. Please use an OCR-enabled version.");
      }
      
      const result = await processWithGemini(text);
      setData(result);
      setStatus('success');
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  };

  const handleTrySample = () => {
    setStatus('loading');
    setErrorMsg('');
    // Simulate network delay for realistic feel
    setTimeout(() => {
      setData(mockSampleData);
      setStatus('success');
    }, 1500);
  };

  const exportReport = () => {
    if (!data) return;
    
    // Generate a simple, readable HTML report that MS Word can open natively
    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>Billing Compliance Report</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
        h1 { color: #2c3e50; border-bottom: 2px solid #eee; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 25px; }
        .summary-box { border: 1px solid #ddd; padding: 15px; background: #f8f9fa; margin-bottom: 20px; border-radius: 5px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
        th { background-color: #eee; }
        .critical { color: #e74c3c; font-weight: bold; }
        .warning { color: #f39c12; font-weight: bold; }
        .info { color: #3498db; font-weight: bold; }
        .discrepancy-item { border-left: 4px solid #ccc; padding-left: 15px; margin-bottom: 15px; background: #fafafa; padding: 10px 10px 10px 15px; }
      </style>
      </head>
      <body>
        <h1>Hospital Billing Compliance Report</h1>
        <div class="summary-box">
          <p><strong>Patient ID:</strong> ${data.encounter.patient_id || 'N/A'}</p>
          <p><strong>Facility:</strong> ${data.encounter.facility || 'N/A'}</p>
          <p><strong>Dates of Service:</strong> ${data.encounter.admission_date || 'N/A'} to ${data.encounter.discharge_date || 'N/A'}</p>
          <p><strong>Total Billed:</strong> ${formatCurrency(data.encounter.total_billed)}</p>
          <p><strong>Flagged Amount:</strong> ${formatCurrency(data.total_flagged_amount)}</p>
          <p><strong>Estimated Recovery:</strong> ${formatCurrency(data.estimated_total_recovery)}</p>
          <p><strong>Audit Risk Score:</strong> ${data.risk_score} / 100</p>
        </div>
        
        <h2>Discrepancies Identified (${data.discrepancies?.length || 0})</h2>
        ${(!data.discrepancies || data.discrepancies.length === 0) ? '<p>No discrepancies found.</p>' : ''}
        ${data.discrepancies?.map(d => `
          <div class="discrepancy-item" style="border-left-color: ${d.severity === 'critical' ? '#e74c3c' : d.severity === 'warning' ? '#f39c12' : '#3498db'};">
            <p><span class="${d.severity}">${d.severity.toUpperCase()}</span> - <strong>${d.type.replace(/_/g, ' ').toUpperCase()}</strong></p>
            <p>${d.description}</p>
            <p><strong>Code:</strong> ${d.cpt_code || d.icd_code || 'N/A'}</p>
            <p><strong>Billed vs Correct:</strong> ${formatCurrency(d.billed_amount)} / ${formatCurrency(d.correct_amount)}</p>
            <p><em>Suggestion: ${d.suggestion}</em></p>
          </div>
        `).join('') || ''}

        <h2>Itemized Charges</h2>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Description</th>
              <th>Units</th>
              <th>Billed Amount</th>
            </tr>
          </thead>
          <tbody>
            ${data.line_items?.map(item => `
              <tr style="${item.flagged ? 'background-color: #ffeaea;' : ''}">
                <td>${item.cpt_code || ''}</td>
                <td>${item.description || ''}</td>
                <td>${item.units || ''}</td>
                <td>${formatCurrency(item.billed_amount)}</td>
              </tr>
            `).join('') || ''}
          </tbody>
        </table>
        
        <p style="font-size: 12px; color: #777; margin-top: 40px; text-align: center;">Generated automatically by Hospital Billing PDF Discrepancy Finder.</p>
      </body>
      </html>
    `;

    // Create a Blob containing the HTML data with MS Word MIME type
    const blob = new Blob(['\ufeff', htmlContent], {
      type: 'application/msword'
    });

    // Create a download link and trigger it
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Billing_Compliance_Report_${data.encounter.patient_id ? data.encounter.patient_id.replace(/\s+/g, '_') : 'Unknown'}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const formatCurrency = (val) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val || 0);

  const getSeverityIcon = (sev) => {
    switch(sev) {
      case 'critical': return <ShieldAlert size={16} />;
      case 'warning': return <AlertCircle size={16} />;
      case 'info': return <Info size={16} />;
      default: return <Info size={16} />;
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <Activity className="logo-icon" />
          <h1>Hospital Billing PDF Discrepancy Finder</h1>
        </div>
        <div className="header-actions">


          <button className="btn btn-outline" onClick={handleTrySample}>
            <Play size={16} /> Try with Sample
          </button>
          {status === 'success' && (
            <button className="btn btn-outline" onClick={() => { setStatus('idle'); setData(null); }}>
              <RefreshCw size={16} /> New Audit
            </button>
          )}
          {status === 'success' && (
            <button className="btn btn-primary" onClick={exportReport}>
              <Download size={16} /> Export Report
            </button>
          )}
        </div>
      </header>

      {errorMsg && (
        <div className={errorMsg.startsWith('✅') ? 'success-banner' : 'error-banner'}>
          {!errorMsg.startsWith('✅') && <FileWarning size={18} style={{marginRight: '8px', verticalAlign: 'middle'}}/>}
          {errorMsg}
        </div>
      )}

      {status === 'idle' || status === 'error' ? (
        <div 
          className={`upload-container ${isDragging ? 'dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              fileInputRef.current.files = e.dataTransfer.files;
              handleFileUpload({ target: { files: e.dataTransfer.files } });
            }
          }}
          onClick={() => fileInputRef.current.click()}
        >
          <Upload size={48} className="upload-icon" />
          <h3>Drag &amp; Drop Hospital Bill PDF</h3>
          <p>or click to browse (Max 20MB)</p>
          <p style={{fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '6px'}}>
            Powered by <strong>Gemini 2.0 Flash Lite</strong>
          </p>
          <input type="file" className="file-input" ref={fileInputRef} onChange={handleFileUpload} accept=".pdf" />
        </div>
      ) : status === 'loading' ? (
        <div className="loading-container">
          <div className="spinner"></div>
          <div style={{color: 'var(--text-secondary)'}}>Analyzing hospital bill against CMS guidelines via Gemini Flash...</div>
          <div style={{width: '300px', height: '8px'}} className="skeleton-pulse"></div>
        </div>
      ) : (
        <div className="dashboard">
          <div className="summary-bar">
            <div className="summary-card">
              <span className="summary-label">Total Billed</span>
              <span className="summary-value">{formatCurrency(data.encounter.total_billed)}</span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Flagged Amount</span>
              <span className="summary-value risk">{formatCurrency(data.total_flagged_amount)}</span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Est. Recovery</span>
              <span className="summary-value recovery">{formatCurrency(data.estimated_total_recovery)}</span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Audit Risk Score</span>
              <span className={`summary-value ${data.risk_score > 75 ? 'risk' : ''}`}>{data.risk_score} / 100</span>
            </div>
          </div>

          <div className="three-panel-layout">
            {/* Left Panel: Encounter Info */}
            <div className="panel">
              <div className="panel-header">
                <FileText size={16} /> Encounter Summary
              </div>
              <div className="panel-content">
                <div className="info-group">
                  <div className="info-label">Patient ID</div>
                  <div className="info-value" style={{fontFamily: 'monospace'}}>{data.encounter.patient_id}</div>
                </div>
                <div className="info-group">
                  <div className="info-label">Facility</div>
                  <div className="info-value">{data.encounter.facility}</div>
                </div>
                <div className="divider"></div>
                <div className="info-group">
                  <div className="info-label">Dates of Service</div>
                  <div className="info-value">{data.encounter.admission_date} to {data.encounter.discharge_date}</div>
                </div>
                <div className="info-group">
                  <div className="info-label">DRG Code</div>
                  <div className="info-value">{data.encounter.drg_code}</div>
                </div>
                <div className="info-group">
                  <div className="info-label">Primary ICD-10</div>
                  <div className="info-value">{data.encounter.primary_diagnosis_icd}</div>
                </div>
                <div className="divider"></div>
                <div className="info-group">
                  <div className="info-label">Attending Physician</div>
                  <div className="info-value">{data.encounter.attending_physician}</div>
                </div>
                <div className="info-group" style={{marginTop: '24px', padding: '12px', backgroundColor: '#f8fafc', borderRadius: '6px', fontSize: '0.8rem'}}>
                  <strong>AI Summary:</strong><br/>{data.summary}
                </div>
              </div>
            </div>

            {/* Center Panel: Line Items */}
            <div className="panel">
              <div className="panel-header">
                <DollarSign size={16} /> Itemized Charges
              </div>
              <div className="panel-content" style={{padding: 0}}>
                <table className="table-container">
                  <thead>
                    <tr>
                      <th>CPT/Code</th>
                      <th>Description</th>
                      <th className="align-right">Units</th>
                      <th className="align-right">Billed</th>
                      <th className="align-right">Expected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.line_items.map((item, idx) => (
                      <tr key={idx} className={item.flagged ? 'row-flagged' : ''}>
                        <td><span className="code-badge">{item.cpt_code}</span></td>
                        <td>{item.description}</td>
                        <td className="align-right">{item.units}</td>
                        <td className="align-right money">{formatCurrency(item.billed_amount)}</td>
                        <td className="align-right money">{formatCurrency(item.cms_expected_rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Panel: Discrepancies */}
            <div className="panel">
              <div className="panel-header">
                <ShieldAlert size={16} /> Discrepancy Report ({data.discrepancies.length})
              </div>
              <div className="panel-content">
                {data.discrepancies.map((disc, idx) => (
                  <div key={idx} className={`discrepancy-card severity-${disc.severity}`}>
                    <div className="card-header">
                      <span className={`badge badge-${disc.severity}`}>
                        {getSeverityIcon(disc.severity)} {disc.severity}
                      </span>
                      <span className="card-type">{disc.type.replace('_', ' ')}</span>
                    </div>
                    <p className="card-desc">{disc.description}</p>
                    <div className="card-meta">
                      <div className="card-meta-label">Code:</div>
                      <div className="card-meta-value"><span className="code-badge">{disc.cpt_code || disc.icd_code}</span></div>
                      
                      <div className="card-meta-label">Billed vs Correct:</div>
                      <div className="card-meta-value">{formatCurrency(disc.billed_amount)} / {formatCurrency(disc.correct_amount)}</div>
                    </div>
                    <div className="card-suggestion">
                      <CheckCircle2 className="card-suggestion-icon" size={14} />
                      <span>{disc.suggestion}</span>
                    </div>
                    {disc.cms_reference && (
                      <div style={{fontSize: '0.65rem', marginTop: '8px', color: 'var(--text-secondary)'}}>
                        Ref: {disc.cms_reference}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
