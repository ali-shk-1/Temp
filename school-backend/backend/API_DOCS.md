# School Management — API Reference

Base URL: `http://localhost:5000`

All protected routes require:
```
Authorization: Bearer <token>
```

---

## Auth

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| POST | `/api/auth/login` | ❌ | — | Login, returns JWT |
| GET | `/api/auth/me` | ✅ | any | Get own profile |
| POST | `/api/auth/change-password` | ✅ | any | Change own password |
| POST | `/api/auth/register` | ✅ | admin | Create new user account |
| PATCH | `/api/auth/users/:id/toggle` | ✅ | admin | Enable/disable account |

### POST /api/auth/login
```json
{
  "username": "admin",
  "password": "Admin@123"
}
```
**Response:**
```json
{
  "token": "eyJ...",
  "user": { "user_id": 1, "username": "admin", "role": "admin" }
}
```

---

## Dashboard

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/dashboard` | ✅ | KPIs + chart data |

---

## Students

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/students` | ✅ | any | List all (filterable) |
| GET | `/api/students/:id` | ✅ | any | Get one student |
| GET | `/api/students/meta/classes` | ✅ | any | Distinct class/section list |
| POST | `/api/students` | ✅ | admin, accountant | Add student |
| PUT | `/api/students/:id` | ✅ | admin, accountant | Update student |
| DELETE | `/api/students/:id` | ✅ | admin | Delete student |

### GET /api/students — Query Params
| Param | Example | Description |
|-------|---------|-------------|
| `class` | `5` | Filter by class |
| `section` | `A` | Filter by section |
| `search` | `Ali` | Search by name or roll no |

### POST /api/students — Body
```json
{
  "roll_no": 12,
  "section": "A",
  "class": "5",
  "first_name": "Ali",
  "last_name": "Khan",
  "father_name": "Imran Khan",
  "contact_1": "03001234567",
  "contact_2": null,
  "address": "House 5, Street 3, Rawalpindi"
}
```

---

## Staff

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/staff` | ✅ | any | List staff |
| GET | `/api/staff/:id` | ✅ | any | Get one staff member |
| POST | `/api/staff` | ✅ | admin | Add staff |
| PUT | `/api/staff/:id` | ✅ | admin | Update staff |
| DELETE | `/api/staff/:id` | ✅ | admin | Delete staff |
| GET | `/api/staff/designations` | ✅ | any | List designations |
| POST | `/api/staff/designations` | ✅ | admin | Add designation |
| DELETE | `/api/staff/designations/:id` | ✅ | admin | Delete designation |

### POST /api/staff — Body
```json
{
  "name": "Sana Mirza",
  "staff_code": "TCH-001",
  "cnic": "3740512345671",
  "phone_no": "03211234567",
  "salary": 25000.00,
  "designation_id": 3
}
```

---

## Fees

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| POST | `/api/fees` | ✅ | admin, accountant | Record payment |
| GET | `/api/fees/student/:student_id` | ✅ | any | Student fee history |
| GET | `/api/fees/summary/monthly` | ✅ | any | Monthly totals |
| GET | `/api/fees/summary/yearly` | ✅ | any | Year month-by-month |
| GET | `/api/fees/defaulters` | ✅ | any | Students with balance |
| PUT | `/api/fees/:payment_id` | ✅ | admin, accountant | Update payment |
| DELETE | `/api/fees/:payment_id` | ✅ | admin | Delete payment |

### POST /api/fees — Body
```json
{
  "student_id": 5,
  "academic_month": "2025-10-01",
  "amount_due": 2500.00,
  "amount_paid": 2500.00
}
```

### GET /api/fees/defaulters — Query Params
| Param | Example |
|-------|---------|
| `month` | `2025-10` |

---

## Expenses

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/expenses` | ✅ | any | List expenses (filterable) |
| GET | `/api/expenses/:id` | ✅ | any | Get one expense |
| POST | `/api/expenses` | ✅ | admin, accountant | Add expense |
| PUT | `/api/expenses/:id` | ✅ | admin, accountant | Update expense |
| DELETE | `/api/expenses/:id` | ✅ | admin | Delete expense |
| GET | `/api/expenses/categories` | ✅ | any | List categories |
| POST | `/api/expenses/categories` | ✅ | admin | Add category |
| DELETE | `/api/expenses/categories/:id` | ✅ | admin | Delete category |
| GET | `/api/expenses/reports/by-category` | ✅ | any | Spend by category |
| GET | `/api/expenses/reports/monthly-trend` | ✅ | any | Monthly spend trend |

### GET /api/expenses — Query Params
| Param | Example | Description |
|-------|---------|-------------|
| `category_id` | `2` | Filter by category |
| `month` | `2025-10` | Expenses in that month |
| `from` | `2025-10-01` | Date range start |
| `to` | `2025-10-31` | Date range end |

### POST /api/expenses — Body
```json
{
  "category_id": 1,
  "amount": 5000.00,
  "description": "Electricity bill October",
  "created_at": "2025-10-15"
}
```

---

## Error Responses

All errors return JSON:
```json
{ "error": "Human-readable message here." }
```

| Code | Meaning |
|------|---------|
| 400 | Bad request / missing fields |
| 401 | Missing or expired token |
| 403 | Forbidden (wrong role) |
| 404 | Record not found |
| 409 | Duplicate entry |
| 500 | Server error |
