# Ghi chú lỗi ghi âm với Sox trên Windows

## Hiện tượng
- Khi sử dụng chức năng ghi âm, file âm thanh (mp3/wav) được tạo ra nhưng có kích thước 0 byte hoặc không tồn tại.
- Log báo lỗi: `sox process exited with code: 1` hoặc `Audio file does not exist`.
- Khi gửi file lên Whisper API, trả về lỗi: `Invalid file format` hoặc file rỗng.

## Nguyên nhân
- Sox không ghi được âm thanh từ microphone do không nhận diện đúng thiết bị ghi âm trên Windows.
- Tham số `-d` hoặc input mặc định không hoạt động tốt trên Windows.
- Khi ghi file mp3, nếu thiếu codec mp3, file sẽ không được ghi đúng.

## Cách khắc phục
1. **Kiểm tra thiết bị ghi âm:**
   - Đảm bảo microphone hoạt động và được chọn làm thiết bị mặc định trong Windows Sound Settings.
2. **Kiểm tra codec Sox:**
   - Đảm bảo Sox hỗ trợ format bạn muốn ghi (wav/mp3). Kiểm tra bằng `sox -h`.
3. **Sử dụng tham số đúng cho Sox trên Windows:**
   - Dùng `-t waveaudio default` làm input thay vì `-d`.
   - Ghi file WAV để đảm bảo tương thích tốt nhất:
     ```
     sox -t waveaudio default -t wav output.wav
     ```
4. **Nếu cần file mp3:**
   - Ghi file WAV trước, sau đó convert sang mp3 bằng ffmpeg hoặc Sox nếu có codec.

## Kết luận
- Để ghi âm thành công trên Windows với Sox, nên dùng input `-t waveaudio default` và ghi file WAV.
- Nếu vẫn lỗi, kiểm tra lại thiết bị ghi âm và codec Sox. 