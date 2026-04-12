import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export default function LeadBulkUpload({ onComplete }) {
  const [file, setFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const uploadMutation = useMutation({
    mutationFn: async (file) => {
      setUploadStatus('uploading');
      
      // 1. Upload file
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      setUploadStatus('extracting');
      
      // 2. Extract data from file
      const extractResult = await base44.integrations.Core.ExtractDataFromUploadedFile({
        file_url,
        json_schema: {
          type: "object",
          properties: {
            leads: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  full_name: { type: "string" },
                  phone: { type: "string" },
                  email: { type: "string" },
                  city: { type: "string" },
                  address: { type: "string" },
                  source: { type: "string" },
                  notes: { type: "string" }
                },
                required: ["full_name", "phone"]
              }
            }
          }
        }
      });

      if (extractResult.status === 'error') {
        throw new Error(extractResult.details || 'Failed to extract data');
      }

      const leads = extractResult.output.leads;
      setProgress({ current: 0, total: leads.length });
      setUploadStatus('processing');

      const results = {
        created: 0,
        updated: 0,
        failed: 0,
        errors: []
      };

      // 3. Process each lead
      for (let i = 0; i < leads.length; i++) {
        const leadData = leads[i];
        
        try {
          // Check if lead exists by phone
          const existingLeads = await base44.entities.Lead.filter({ phone: leadData.phone });
          
          if (existingLeads.length > 0) {
            // Update existing lead
            const existingLead = existingLeads[0];
            await base44.entities.Lead.update(existingLead.id, {
              full_name: leadData.full_name,
              email: leadData.email || existingLead.email,
              city: leadData.city || existingLead.city,
              address: leadData.address || existingLead.address,
              notes: leadData.notes ? 
                `${existingLead.notes || ''}\n[${new Date().toLocaleDateString('he-IL')}] ${leadData.notes}`.trim() 
                : existingLead.notes
            });
            results.updated++;
          } else {
            // Create new lead
            await base44.entities.Lead.create({
              full_name: leadData.full_name,
              phone: leadData.phone,
              email: leadData.email || '',
              city: leadData.city || '',
              address: leadData.address || '',
              source: leadData.source || 'digital',
              status: 'new',
              notes: leadData.notes || ''
            });
            results.created++;
          }
        } catch (error) {
          results.failed++;
          results.errors.push(`${leadData.phone}: ${error.message}`);
        }
        
        setProgress({ current: i + 1, total: leads.length });
      }

      return results;
    },
    onSuccess: (results) => {
      setUploadStatus('complete');
      if (onComplete) {
        onComplete(results);
      }
    },
    onError: (error) => {
      setUploadStatus('error');
      console.error('Upload error:', error);
    }
  });

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setUploadStatus(null);
    }
  };

  const handleUpload = () => {
    if (file) {
      uploadMutation.mutate(file);
    }
  };

  const getStatusMessage = () => {
    switch (uploadStatus) {
      case 'uploading':
        return 'מעלה קובץ...';
      case 'extracting':
        return 'מחלץ נתונים...';
      case 'processing':
        return `מעבד לידים (${progress.current}/${progress.total})`;
      case 'complete':
        return 'הושלם בהצלחה!';
      case 'error':
        return 'אירעה שגיאה';
      default:
        return '';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>העלאת לידים מקובץ</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            העלה קובץ CSV/Excel עם לידים. המערכת תזהה אוטומטית לידים קיימים לפי מספר טלפון ותעדכן אותם.
          </p>
          <p className="text-xs text-muted-foreground">
            עמודות נדרשות: full_name, phone. עמודות אופציונליות: email, city, address, source, notes
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileChange}
            disabled={uploadMutation.isPending}
          />
          <Button
            onClick={handleUpload}
            disabled={!file || uploadMutation.isPending}
            className="whitespace-nowrap"
          >
            {uploadMutation.isPending ? (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 me-2" />
            )}
            העלה
          </Button>
        </div>

        {uploadStatus && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              {uploadStatus === 'complete' && (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              )}
              {uploadStatus === 'error' && (
                <AlertCircle className="h-5 w-5 text-red-600" />
              )}
              {uploadMutation.isPending && (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              )}
              <span>{getStatusMessage()}</span>
            </div>

            {uploadStatus === 'processing' && (
              <Progress value={(progress.current / progress.total) * 100} />
            )}

            {uploadStatus === 'complete' && uploadMutation.data && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg space-y-1">
                <p className="text-sm font-medium text-green-800">
                  ✓ נוצרו {uploadMutation.data.created} לידים חדשים
                </p>
                <p className="text-sm font-medium text-blue-800">
                  ✓ עודכנו {uploadMutation.data.updated} לידים קיימים
                </p>
                {uploadMutation.data.failed > 0 && (
                  <p className="text-sm font-medium text-red-800">
                    ✗ נכשלו {uploadMutation.data.failed} לידים
                  </p>
                )}
              </div>
            )}

            {uploadStatus === 'error' && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-800">
                  אירעה שגיאה בעת העלאת הקובץ. אנא נסה שוב.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}