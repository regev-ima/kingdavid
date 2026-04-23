import { createServiceClient, getUser, corsHeaders } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin only' }, { status: 403, headers: corsHeaders });
    }

    const body = await req.json();

    // Direct invite path: invite a single user by email (used by Representatives/Settings UI).
    if (body.directInvite) {
      return await handleDirectInvite(body);
    }

    const { spreadsheet_id, sheet_name, column_mapping } = body;

    if (!spreadsheet_id || !sheet_name) {
      return Response.json({
        error: 'Missing required fields: spreadsheet_id, sheet_name'
      }, { status: 400, headers: corsHeaders });
    }

    if (!column_mapping || !column_mapping.email || !column_mapping.full_name) {
      return Response.json({
        error: 'Missing required column mapping: email and full_name are required'
      }, { status: 400, headers: corsHeaders });
    }

    // Use Google Sheets API with API key
    const apiKey = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Google Sheets API key not configured' }, { status: 500, headers: corsHeaders });
    }

    // Fetch data from Google Sheets
    const sheetsResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${encodeURIComponent(sheet_name)}?key=${apiKey}`
    );

    if (!sheetsResponse.ok) {
      const errorText = await sheetsResponse.text();
      return Response.json({
        error: 'Failed to fetch from Google Sheets',
        details: errorText
      }, { status: 400, headers: corsHeaders });
    }

    const sheetsData = await sheetsResponse.json();
    const rows = sheetsData.values || [];

    if (rows.length === 0) {
      return Response.json({ error: 'No data found in sheet' }, { status: 400, headers: corsHeaders });
    }

    const supabase = createServiceClient();

    const headers = rows[0];
    const dataRows = rows.slice(1);

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    };

    // Process each row
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowData: Record<string, string> = {};

      headers.forEach((header: string, index: number) => {
        rowData[header] = row[index] || '';
      });

      try {
        // Extract user data from row using column mapping
        const email = rowData[column_mapping.email];
        const fullName = rowData[column_mapping.full_name];
        const role = column_mapping.role ? (rowData[column_mapping.role] || 'user') : 'user';

        if (!email || !fullName) {
          results.failed++;
          results.errors.push(`Row ${i + 2}: Missing email or full_name`);
          continue;
        }

        // Create the user in Supabase Auth via admin API
        // Generate a random password - user will need to reset it
        const tempPassword = crypto.randomUUID();
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });

        if (authError) {
          // If user already exists in auth, try to find and update their profile
          if (authError.message?.includes('already') || authError.message?.includes('exists')) {
            // User already exists in auth - just update profile below
          } else {
            results.failed++;
            results.errors.push(`Row ${i + 2}: ${authError.message}`);
            continue;
          }
        }

        // Build user profile data
        const phone = column_mapping.phone ? rowData[column_mapping.phone] : null;
        const voicenterExtension = column_mapping.voicenter_extension ? rowData[column_mapping.voicenter_extension] : null;
        const commissionRate = column_mapping.commission_rate ? parseFloat(rowData[column_mapping.commission_rate] || '3') : 3;
        const isActive = column_mapping.is_active ? rowData[column_mapping.is_active] : null;

        // Build update data object
        const updateData: Record<string, any> = {
          full_name: fullName,
          role,
        };
        if (phone) updateData.phone = phone;
        if (voicenterExtension) updateData.voicenter_extension = voicenterExtension;
        if (commissionRate) updateData.commission_rate = commissionRate;
        if (isActive !== undefined && isActive !== null && isActive !== '') {
          updateData.is_active = isActive === 'true' || isActive === 'TRUE' || isActive === 'כן';
        }

        // Update user profile in users table
        const { data: existingUsers } = await supabase
          .from('users')
          .select('*')
          .eq('email', email);

        if (existingUsers && existingUsers.length > 0) {
          await supabase
            .from('users')
            .update(updateData)
            .eq('id', existingUsers[0].id);
        } else {
          // Create user profile if it doesn't exist yet
          // Link to auth user if we created one
          const profileData: Record<string, any> = {
            email,
            ...updateData,
          };
          if (authData?.user) {
            profileData.auth_id = authData.user.id;
          }
          await supabase
            .from('users')
            .insert(profileData);
        }

        results.success++;

      } catch (error) {
        results.failed++;
        results.errors.push(`Row ${i + 2}: ${error.message}`);
      }
    }

    return Response.json({
      message: 'Import completed',
      results
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});

async function handleDirectInvite(body: Record<string, any>) {
  const email: string | undefined = body.email?.trim();
  const role: string = body.role || 'user';
  const fullName: string | undefined = body.full_name || body.fullName;
  const redirectTo: string | undefined = body.redirectTo;

  console.log('[directInvite] start', { email, role, hasFullName: !!fullName, redirectTo });

  if (!email) {
    return Response.json({ error: 'Missing required field: email' }, { status: 400, headers: corsHeaders });
  }

  const supabase = createServiceClient();

  // Step 1: ensure the users-table row exists first so the rep shows up as "pending"
  // in the CRM even if the invitation email later fails (e.g. SMTP rate limit).
  const { data: existingProfiles, error: lookupError } = await supabase
    .from('users')
    .select('id, auth_id')
    .eq('email', email);

  if (lookupError) {
    console.error('[directInvite] profile lookup failed', lookupError);
    return Response.json({ error: `Profile lookup failed: ${lookupError.message}` }, { status: 500, headers: corsHeaders });
  }

  const hasExistingProfile = !!(existingProfiles && existingProfiles.length > 0);
  const profileBase: Record<string, any> = {
    role,
    full_name: fullName || email.split('@')[0],
  };

  if (hasExistingProfile) {
    const { error } = await supabase.from('users').update(profileBase).eq('id', existingProfiles![0].id);
    if (error) {
      console.error('[directInvite] profile update failed', error);
      return Response.json({ error: `Profile update failed: ${error.message}` }, { status: 500, headers: corsHeaders });
    }
  } else {
    const { error } = await supabase.from('users').insert({
      email,
      is_active: true,
      ...profileBase,
    });
    if (error) {
      console.error('[directInvite] profile insert failed', error);
      return Response.json({ error: `Profile insert failed: ${error.message}` }, { status: 500, headers: corsHeaders });
    }
  }

  // Step 2: try to send the invitation email. A failure here (rate limit, SMTP misconfig, etc.)
  // should NOT undo the profile row — the rep is already in the list as pending, and the admin
  // can resend later.
  const inviteOptions: Record<string, any> = {};
  if (fullName) inviteOptions.data = { full_name: fullName };
  if (redirectTo) inviteOptions.redirectTo = redirectTo;

  const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
    email,
    Object.keys(inviteOptions).length ? inviteOptions : undefined,
  );

  let authUserId: string | null = inviteData?.user?.id ?? null;
  let alreadyRegistered = false;
  let emailSent = !inviteError;
  let emailError: string | null = null;

  if (inviteError) {
    const msg = inviteError.message?.toLowerCase() || '';
    console.log('[directInvite] inviteUserByEmail error', { message: inviteError.message });
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      alreadyRegistered = true;
      // Link the existing auth user to the profile so future logins resolve.
      const { data: listData } = await supabase.auth.admin.listUsers();
      const found = listData?.users?.find((u: { email?: string }) => u.email === email);
      if (found) authUserId = found.id;
    } else {
      emailError = inviteError.message;
    }
  } else {
    console.log('[directInvite] invite email sent', { authUserId });
  }

  // Step 3: if we now have an auth_id, link it to the profile.
  if (authUserId) {
    const { error } = await supabase.from('users').update({ auth_id: authUserId }).eq('email', email);
    if (error) {
      console.error('[directInvite] auth_id link failed', error);
    }
  }

  console.log('[directInvite] done', { email, role, emailSent, alreadyRegistered, emailError });

  // Profile exists either way. Surface email outcome so the UI can message correctly.
  const message = emailSent
    ? 'Invitation sent'
    : alreadyRegistered
      ? 'User already registered; profile updated (no new email sent)'
      : `Profile created, but invitation email failed: ${emailError}`;

  return Response.json({
    message,
    email,
    role,
    profile_created: !hasExistingProfile,
    already_registered: alreadyRegistered,
    email_sent: emailSent,
    email_error: emailError,
  }, { headers: corsHeaders });
}
