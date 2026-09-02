# Teams, Members & Sharing API

مجموعة مسارات `/api/v1/teams`, `/api/v1/members`, `/api/v1/invitations`, `/api/v1/shares`, `/api/v1/share/[token]` التي تنفّذ طبقة "Workspace Collaboration" (Phase 5): عضوية، أدوار (owner/admin/editor/viewer)، دعوات، فرق، مشاركة الموارد، وروابط عامة للقراءة فقط.

```mermaid
flowchart LR
  Owner[Owner/Admin] -->|invite| inv[POST /members action=invite]
  inv -->|email known| direct[upsert membership]
  inv -->|email new| inviteRow[(invitations)]
  inviteRow --> Invitee[Invitee]
  Invitee -->|GET /invitations| inbox[POST /invitations action=accept|Decline]
  Owner -->|teams| teams[POST /teams]
  teams --> tm[(team_members)]
  Owner -->|share| shares[POST /shares]
  shares --> ACL[(resource_shares)]
  Public[Anyone with link] -->|/share/token| PublicRead[GET /share/:token]
```

## المصادقة والصلاحيات

| المسار                                                  | الصلاحية                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| `GET /teams`                                            | `members:read`                                                |
| `POST /teams` (actions)                                 | `members:manage`                                              |
| `GET /members`                                          | `members:read`                                                |
| `POST /members` (invite/remove/changeRole/revokeInvite) | `members:manage`                                              |
| `GET /invitations`                                      | (دعوات موجهة لبريد المتصل فقط)                                |
| `POST /invitations` (accept/decline)                    | (متصل مسجّل)                                                  |
| `GET /shares?resourceType=&resourceId=`                 | الصلاحية المقابلة للمورد                                      |
| `GET /shares` (overview)                                | `members:read`                                                |
| `POST /shares` (share/setLink/unshare)                  | `documents:write \| collections:write \| conversations:write` |
| `GET /share/[token]`                                    | **عام**، لكن محدود بـ 20 طلب/دقيقة (`public-share-link`).     |

---

## `GET/POST /api/v1/teams`

### `GET`

```json
{
  "teams": [
    {
      "id": "team-...",
      "name": "Research",
      "description": "...",
      "createdAt": "...",
      "members": [{ "userId": "...", "email": "...", "addedBy": "...", "createdAt": "..." }]
    }
  ]
}
```

### `POST` (actions discriminator)

| `action`       | الحقول                           | الوصف                          |
| -------------- | -------------------------------- | ------------------------------ |
| `create`       | `name`, `description?`           | ينشئ فريقاً. quota `maxTeams`. |
| `rename`       | `teamId`, `name`, `description?` | يحدّث الاسم.                   |
| `delete`       | `teamId`                         | يحذف الفريق (لا يحذف الأعضاء). |
| `addMember`    | `teamId`, `userId`               | يضيف عضواً نشطاً فقط.          |
| `removeMember` | `teamId`, `userId`               | يزيل عضواً.                    |

قواعد:

- إضافة عضو تتطلب عضوية نشطة في الـ workspace.
- كل تغيير يُسجَّل في `audit_logs`.

---

## `GET/POST /api/v1/members`

### `GET`

```json
{
  "members": [
    {
      "id": "mem-...",
      "userId": "...",
      "email": "...",
      "role": "editor",
      "status": "active",
      "invitedBy": "...",
      "createdAt": "...",
      "isSelf": false
    }
  ],
  "invitations": [{ "id": "inv-...", "email": "...", "role": "viewer", "expiresAt": "...", "createdAt": "..." }]
}
```

### `POST` (actions)

| `action`       | الحقول           | ملاحظات                                                   |
| -------------- | ---------------- | --------------------------------------------------------- |
| `invite`       | `email`, `role?` | ينشئ عضوية مباشرة إن كان البريد معروفاً، وإلا يدعو.       |
| `changeRole`   | `userId`, `role` | حماية last-owner (لا يمكن تخفيض المالك الوحيد).           |
| `remove`       | `userId`         | يحذف العضوية + جلسات المستأجر للمستخدم. حماية last-owner. |
| `revokeInvite` | `invitationId`   | يلغي دعوة معلقة.                                          |

- رموز: 400 `Invalid email`، 404 `Member not found`، 409 `Already a member`.
- quota `maxMembers`.

---

## `GET/POST /api/v1/invitations`

### `GET`

صندوق الوارد للمتصل (دعوات موجهة لبريده عبر كل المستأجرين).

### `POST`

| `action`  | الحقول  |
| --------- | ------- |
| `accept`  | `token` |
| `decline` | `token` |

- `accept` يفحص `maxMembers` على المستأجر الهدف.
- يتحقق أن البريد المتصل يطابق الدعوة (`403` إن لم يطابق).
- عند القبول يُنشئ membership ويرسل `INVITATION_ACCEPTED` لـ audit.

---

## `GET/POST /api/v1/shares`

### `GET ?resourceType=&resourceId=`

ACL لمورد محدد (collection/conversation/document). يفرض صلاحية القراءة لذلك النوع.

### `GET` بدون params

نظرة عامة على كل المشاركات في المستأجر (يتطلب `members:read`).

### `POST` (actions)

| `action`  | الحقول                                                                                                 | الوصف                             |
| --------- | ------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `share`   | `resourceType`, `resourceId`, `granteeType` (`user`/`team`), `granteeId`, `permission` (`read`/`edit`) | مشاركة لمستخدم/فريق.              |
| `setLink` | `resourceType`, `resourceId`, `enable`, `regenerate?`, `expiresAt?`                                    | تفعيل/إلغاء رابط عام للقراءة فقط. |
| `unshare` | `shareId`                                                                                              | إزالة مشاركة.                     |

- `setLink` يولّد `linkToken` 192-بت (`randomBytes(24).toString('hex')`).
- كل تغيير يُسجَّل في `audit_logs`.

---

## `GET /api/v1/share/[token]` (عام)

لا يحتاج مصادقة — **امتلاك الرابط هو الاعتماد**. يفرض 20 طلب/دقيقة لكل IP عبر `checkRateLimit(..., 'public-share-link')`.

```json
{
  "resourceType": "document",
  "sharedAt": "...",
  "document": { "id": "...", "title": "...", "chunkCount": 12, "content": "first 4000 chars...", "truncated": false }
}
```

- `document.content` مقصوص إلى `SHARED_EXCERPT_LIMIT = 4000` حرف.
- `conversation` يعيد الرسالة كاملة.
- `collection` يعيد قائمة مقتطفات (500 حرف لكل مستند).

| الكود | المعنى                                                           |
| ----- | ---------------------------------------------------------------- |
| 404   | `Share link invalid or expired` / `Resource no longer available` |
| 429   | `Rate limit exceeded`                                            |

## حماية الـ last-owner

- `changeRole` و`remove` على owner الأخير → 400 `Cannot demote/remove the only owner`.

## انظر أيضاً

- [authentication](../06-security/authentication.md) — الجلسات، CSRF، SSO.
- [schema](../05-database/schema.md) — جداول `memberships`, `invitations`, `resource_shares`.
- [teams & sharing overview](../02-architecture/overview.md) — كيف تتناسب هذه المجموعة مع بقية المعمارية.
