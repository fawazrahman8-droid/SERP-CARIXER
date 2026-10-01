# SerpApi production setup
Backend: Supabase Edge Function serp-ranking in project batqblvjtijcinijyfqd.
Frontend: ranking-provider.js, loaded after cloud.js.
Add SERPAPI_KEY in Supabase > Edge Functions > Secrets. Never add it to config.js, frontend code or GitHub.
The function validates the caller with auth.getUser and looks up owner/editor company membership. The platform JWT check is disabled because the function performs explicit authentication and supports the site's publishable key.
Only database-resolved company domain, keyword and market are searched.
UAE uses Dubai; English, desktop. Up to 10 pages, two extra retries, 90-second search deadline.
Limits: one reserved check per company per UTC minute and 30 per UTC day. Failed provider attempts consume allowance.
provider_checks has RLS, member-only SELECT and no client writes. Original provider records are protected separately from editable manual rankings.
Find ranking fills Google Position on success. Save Ranking still creates/updates a manual entry, not a verified ranking. The existing manual/import schema is unchanged.
The search discrepancy reported during local testing has not been conclusively resolved. A provider result is not a guarantee of what a personalized browser displays.
Validation: 10 mocked provider tests passed. Edge Function deployed ACTIVE. Authenticated has only SELECT on provider_checks; anon has no grant. Live HTTP verification was blocked by this session's network. Full signed-in acceptance test after secret setup is still required.
Security advisor reported no new table findings; existing warning: leaked-password protection disabled. https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
