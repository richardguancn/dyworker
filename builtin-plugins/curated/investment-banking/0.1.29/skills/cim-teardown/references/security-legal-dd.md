# Security + Legal/Regulatory Diligence (Checklist)

## Table of contents
1. Security posture artifacts (what to request)
2. Security red flags
3. Legal/contract diligence artifacts
4. Regulatory considerations (by common regimes)
5. Data privacy and data residency

---

## 1) Security posture artifacts (request list)
Minimum baseline:
- SOC2 Type II report (or gap assessment + timeline)
- Penetration test report (last 12 months) + remediation status
- Vulnerability management policy and tooling
- Incident log for last 24 months (including near-misses)
- Architecture diagram + data flow diagram
- Authentication/authorization design (SSO, MFA)
- Backup and disaster recovery policy (RPO/RTO)

## 2) Security red flags
- "SOC2 in progress" for years with no clear milestones
- No incident log (often means no tracking)
- Customer data in non-prod environments without controls
- Weak tenant isolation in multi-tenant SaaS
- No SDLC controls (code review, CI, secrets management)

## 3) Legal/contract diligence artifacts
- Top 20 customer contracts (and any templates/MSA)
- Full contract list with: term, renewal, termination, change-of-control
- SLAs, service credits, liability caps
- IP assignment agreements for employees/contractors
- Open source policy and SBOM (software bill of materials) if available
- Litigation summary and counsel memo

## 4) Regulatory considerations (common)
Request evidence if claims touch regulated industries:
- GDPR / UK GDPR compliance documentation
- HIPAA (if healthcare data): BAAs, policies
- PCI DSS (if payments)
- FINRA/SEC (if financial services context)
- Data localization requirements (EU, etc.)

## 5) Data privacy and residency
- Data processing agreements (DPAs)
- Subprocessor list
- Data retention and deletion policies
- Data residency options and customer commitments

Note: This checklist is not legal advice; engage counsel for interpretation.
