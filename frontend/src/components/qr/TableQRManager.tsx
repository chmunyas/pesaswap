import { useState, useRef } from 'react';
import { QRCode } from 'react-qr-code';
import { generateTableQRValue } from './QRCard';
import { Download, Printer, QrCode } from 'lucide-react';

interface DinnerTable {
  dinner_table_id: number;
  name: string;
  status: number; // 0 = available, 1 = occupied
}

interface TableQRManagerProps {
  tables: DinnerTable[];
  baseUrl?: string;
  storeName?: string;
}

export function TableQRManager({ tables, baseUrl = window.location.origin, storeName = 'PESASWAP' }: TableQRManagerProps) {
  const [selectedTable, setSelectedTable] = useState<DinnerTable | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow || !printRef.current) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Table QR - ${selectedTable?.name || 'All Tables'}</title>
          <style>
            body { font-family: system-ui, sans-serif; text-align: center; padding: 40px; }
            .qr-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 40px; }
            .qr-item { page-break-inside: avoid; padding: 20px; border: 2px dashed #e5e7eb; border-radius: 12px; }
            .qr-item h3 { margin: 0 0 4px; font-size: 18px; }
            .qr-item p { margin: 4px 0; color: #6b7280; font-size: 12px; }
            svg { margin: 16px auto; }
            @media print { .qr-grid { grid-template-columns: repeat(2, 1fr); } }
          </style>
        </head>
        <body>
          <h1>${storeName} — Table QR Codes</h1>
          <p>Scan to place your order directly</p>
          ${printRef.current.innerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handleDownloadSVG = (tableId: number, tableName: string) => {
    const svg = document.getElementById(`qr-table-${tableId}`);
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `table-${tableName.replace(/\s/g, '-')}-qr.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-indigo-500/10 p-2">
            <QrCode className="h-5 w-5 text-indigo-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Table QR Codes</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Customers scan to view menu & order from their table</p>
          </div>
        </div>
        <button
          onClick={handlePrint}
          className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 transition"
        >
          <Printer className="h-4 w-4" />
          Print All
        </button>
      </div>

      {/* QR Grid */}
      <div ref={printRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {tables.map(table => {
          const qrValue = generateTableQRValue(baseUrl, table.dinner_table_id, table.name);
          return (
            <div
              key={table.dinner_table_id}
              className={`rounded-xl border p-5 text-center transition-all hover:shadow-md cursor-pointer ${
                table.status === 1
                  ? 'bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
              }`}
              onClick={() => setSelectedTable(table)}
            >
              <div className="flex items-center justify-between mb-3">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  table.status === 1
                    ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600'
                    : 'bg-green-100 dark:bg-green-900/30 text-green-600'
                }`}>
                  {table.status === 1 ? 'Occupied' : 'Available'}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDownloadSVG(table.dinner_table_id, table.name); }}
                  className="rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                  title="Download QR"
                >
                  <Download className="h-3.5 w-3.5 text-gray-400" />
                </button>
              </div>

              <div className="inline-block p-2 bg-white rounded-lg shadow-sm">
                <QRCode
                  id={`qr-table-${table.dinner_table_id}`}
                  value={qrValue}
                  size={120}
                  fgColor={table.status === 1 ? '#ea580c' : '#1e40af'}
                />
              </div>

              <h3 className="mt-3 font-semibold text-gray-900 dark:text-white">{table.name}</h3>
              <p className="text-xs text-gray-400 mt-1">Scan to order</p>
            </div>
          );
        })}
      </div>

      {/* Detail Modal */}
      {selectedTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSelectedTable(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-2xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-center text-gray-900 dark:text-white mb-2">{selectedTable.name}</h3>
            <p className="text-center text-sm text-gray-500 mb-6">Scan to place your order</p>
            <div className="flex justify-center p-4 bg-white rounded-xl shadow-inner">
              <QRCode
                value={generateTableQRValue(baseUrl, selectedTable.dinner_table_id, selectedTable.name)}
                size={220}
                fgColor="#1e40af"
              />
            </div>
            <p className="text-center text-xs text-gray-400 mt-4 font-mono">
              {generateTableQRValue(baseUrl, selectedTable.dinner_table_id, selectedTable.name)}
            </p>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => handleDownloadSVG(selectedTable.dinner_table_id, selectedTable.name)}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition"
              >
                <Download className="h-4 w-4" />
                Download
              </button>
              <button
                onClick={handlePrint}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-3 py-2.5 text-sm font-medium text-white hover:bg-indigo-600 transition"
              >
                <Printer className="h-4 w-4" />
                Print
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
