# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |

## Reporting a Vulnerability

If you discover a security vulnerability in StudySphere, please **do not** open a public GitHub issue.

Instead, email: **dalimovich2004@gmail.com**

Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix (optional)

You will receive a response within 72 hours. If the vulnerability is confirmed, a fix will be prioritised and you will be credited in the changelog unless you prefer to remain anonymous.

## Scope

The following are in scope:

- Authentication and session handling
- Subscription and payment flows
- File upload and storage
- API endpoints (`/api/*`)
- Data exposure or privilege escalation

The following are out of scope:

- Denial of service attacks
- Issues requiring physical access to a device
- Social engineering

## Security Measures

- All API endpoints verify JWT tokens via Supabase
- Rate limiting is applied on AI and chat endpoints
- File uploads are validated for type and size server-side
- Admin access is gated by an `admins` table, not client-side flags
- Stripe webhook signatures are verified before processing
- PayPal subscription activations are verified server-side
