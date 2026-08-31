# Space Grotesk — self-hosted font

`style.css` declares `@font-face` pointing to:

```
./assets/fonts/SpaceGrotesk-Variable.woff2
```

That file is **not bundled** in this patch (sandbox này không có mạng để tải binary).
Nếu file không tồn tại, trình duyệt/Electron sẽ tự fallback về
`-apple-system, "Segoe UI", Inter, Roboto, Arial, sans-serif` — app vẫn chạy
và style vẫn đúng, chỉ khác font một chút.

## Cách thêm font thật (làm 1 lần, trên máy bạn có mạng)

1. Tải variable font Space Grotesk (giấy phép OFL, miễn phí) từ một trong hai nguồn:
   - Fontsource: https://fontsource.org/fonts/space-grotesk → tải bản "variable" `.woff2`
   - Google Fonts (Github repo gốc): https://github.com/googlefonts/space-grotesk → build hoặc
     lấy file `SpaceGrotesk[wght].ttf` rồi convert sang `.woff2` (vd bằng `fonttools varLib.instancer`
     hoặc trang https://transfonter.org, chọn "TTF/OTF → WOFF2").
2. Đổi tên file thành `SpaceGrotesk-Variable.woff2` và đặt vào đúng thư mục này
   (`src/renderer/assets/fonts/`).
3. Reload app (`npm start`) — không cần đổi gì trong CSS/CSP, vì file nằm trong app
   (`'self'`) nên không vi phạm `default-src 'self'` / không cần domain Google Fonts nào.

Không bắt buộc — chỉ ảnh hưởng phần chữ, không ảnh hưởng chức năng.
