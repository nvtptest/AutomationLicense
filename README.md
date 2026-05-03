# Bravo Automation License

License management và auto-update backend cho **Bravo Automation Test**.

## Cấu trúc

```
AutomationLicense/
├── data/
│   ├── licenses.enc      # Encrypted: danh sách licenses đã duyệt
│   ├── pending.enc       # Encrypted: yêu cầu đang chờ duyệt
│   └── version.json      # Thông tin phiên bản hiện tại
├── admin/
│   ├── index.html        # Admin panel (GitHub Pages)
│   ├── styles.css
│   └── app.js
└── README.md
```

## Admin Panel

Deploy trang admin qua GitHub Pages:

1. Vào **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `main`, folder: `/admin`
4. URL: `https://nvtptest.github.io/AutomationLicense/admin/`

### Xác thực

Admin panel yêu cầu **GitHub Personal Access Token** (PAT) với quyền `repo`.
Token chỉ lưu trong `sessionStorage` (mất khi đóng tab).

## Encryption

Tất cả dữ liệu license được mã hóa **AES-256-CBC** vì repo là public.
Key mã hóa được hardcode trong cả app lẫn admin panel.

## Auto-Update

1. Cập nhật `data/version.json` với version mới
2. Upload file ZIP lên **GitHub Releases**
3. App sẽ tự check và thông báo khi có update mới
