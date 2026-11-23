
#include <SPI.h>
#include <Wire.h>
#include <MFRC522.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <RTClib.h>
#include <TJpg_Decoder.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// =================================================
// 1. PIN CONFIGURATION
// =================================================

// RFID RC522
#define RFID_SS_PIN   5
#define RFID_RST_PIN  4

// TFT DISPLAY
#define TFT_CS        13
#define TFT_DC        14
#define TFT_RST       25

// LEDs
#define GREEN_LED     26
#define RED_LED       27

// Shared SPI pins
#define SPI_SCK       18
#define SPI_MISO      19
#define SPI_MOSI      23

// RTC I2C
#define I2C_SDA       21
#define I2C_SCL       22

// CAMERA UART
#define CAMERA_RX     16
#define CAMERA_TX     17

// =================================================
// WI-FI / WEBSITE CONFIGURATION
// =================================================
// Put your own 2.4 GHz Wi-Fi credentials and the same SCAN_KEY value
// configured in Vercel into this LOCAL copy before uploading to the ESP32.
// Do not commit real credentials or keys to a public GitHub repository.
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* WEBSITE_SCAN_URL = "https://rfid-attendance-cloud.vercel.app/api/scan";
const char* DEVICE_SCAN_KEY = "YOUR_SCAN_KEY";
const char* DEVICE_ID = "UENR-ATTENDANCE-01";


// =================================================
// 2. COMPONENT OBJECTS
// =================================================

MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);

Adafruit_ILI9341 tft(
  TFT_CS,
  TFT_DC,
  TFT_RST
);

RTC_DS3231 rtc;

HardwareSerial CameraSerial(2);

// =================================================
// 3. RTC CONFIGURATION
// =================================================

// Set true for ONE upload only when setting RTC.
bool SET_RTC_ON_THIS_UPLOAD = false;

// Update these values if you need to set the RTC.
// These example values are not automatically current.

const int RTC_YEAR   = 2026;
const int RTC_MONTH  = 11;
const int RTC_DAY    = 18;

const int RTC_HOUR   = 20;
const int RTC_MINUTE = 25;
const int RTC_SECOND = 0;

// =================================================
// 4. COLOURS
// =================================================

#define BG_COLOR       ILI9341_BLACK
#define HEADER_COLOR   ILI9341_NAVY
#define WHITE_COLOR    ILI9341_WHITE
#define GREEN_COLOR    ILI9341_GREEN
#define RED_COLOR      ILI9341_RED
#define YELLOW_COLOR   ILI9341_YELLOW
#define GREY_COLOR     ILI9341_DARKGREY
#define CYAN_COLOR     ILI9341_CYAN

// =================================================
// 5. STUDENT DATABASE
// =================================================

struct Student {
  byte uid[4];
  const char* name;
  const char* indexNumber;
};

Student students[] = {

  {{0x41, 0xD2, 0x23, 0x03},
   "NICHOLAS", "UEB0965525"},

  {{0xD5, 0xE1, 0x31, 0x03},
   "YAA BABY", "UEB2002150"},

  {{0xD3, 0x0E, 0x92, 0xFB},
   "BEDIAKO", "UEB0987725"}

};

const int NUM_STUDENTS =
  sizeof(students) / sizeof(students[0]);

const unsigned long DISPLAY_DURATION = 5000;

// Maximum allowed JPEG size
const uint32_t MAX_IMAGE_SIZE = 100000;

// =================================================
// 6. TFT JPEG CALLBACK
// =================================================

bool tftOutput(
  int16_t x,
  int16_t y,
  uint16_t w,
  uint16_t h,
  uint16_t *bitmap
) {
  tft.drawRGBBitmap(x, y, bitmap, w, h);
  return true;
}

// =================================================
// 7. FUNCTION DECLARATIONS
// =================================================

void drawHomeScreen();
void drawClock();
void showDenied();
void showAttendance(Student student, DateTime now);
void displayDateTime(DateTime now);

bool captureAndDisplayPhoto();
bool findJPGHeader();
bool sendAttendanceToWebsite(String uidHex);
void connectToWiFi();

// =================================================
// 8. SETUP
// =================================================

void setup() {

  Serial.begin(115200);

  // Start Wi-Fi without preventing the offline attendance system from booting.
  connectToWiFi();

  // LED setup
  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);

  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, LOW);

  // SPI chip select setup
  pinMode(RFID_SS_PIN, OUTPUT);
  pinMode(TFT_CS, OUTPUT);

  digitalWrite(RFID_SS_PIN, HIGH);
  digitalWrite(TFT_CS, HIGH);

  // RTC setup
  Wire.begin(I2C_SDA, I2C_SCL);

  if (!rtc.begin()) {

    Serial.println("DS3231 RTC NOT FOUND!");

    while (true) {
      digitalWrite(RED_LED, HIGH);
      delay(300);
      digitalWrite(RED_LED, LOW);
      delay(300);
    }
  }

  if (SET_RTC_ON_THIS_UPLOAD) {

    rtc.adjust(DateTime(
      RTC_YEAR,
      RTC_MONTH,
      RTC_DAY,
      RTC_HOUR,
      RTC_MINUTE,
      RTC_SECOND
    ));

    Serial.println("RTC TIME UPDATED.");
  }

  if (rtc.lostPower()) {
    Serial.println("WARNING: RTC LOST POWER.");
  }

  // Shared SPI startup
  SPI.begin(
    SPI_SCK,
    SPI_MISO,
    SPI_MOSI,
    RFID_SS_PIN
  );

  // TFT startup
  tft.begin();
  tft.setRotation(1);
  tft.fillScreen(BG_COLOR);

  // JPEG decoder startup
  TJpgDec.setJpgScale(2);
  TJpgDec.setCallback(tftOutput);

  // RFID startup
  rfid.PCD_Init();

  // Camera UART startup
  CameraSerial.begin(
    115200,
    SERIAL_8N1,
    CAMERA_RX,
    CAMERA_TX
  );

  CameraSerial.setTimeout(10000);

  delay(500);

  drawHomeScreen();

  Serial.println();
  Serial.println("==============================");
  Serial.println("UENR SMART ATTENDANCE SYSTEM");
  Serial.println("CAMERA INITIALISED");
  Serial.println("RFID INITIALISED");
  Serial.println("TFT INITIALISED");
  Serial.println("RTC INITIALISED");
  Serial.println("SYSTEM READY");
  Serial.println("==============================");
}

// =================================================
// 9. MAIN LOOP
// =================================================

void loop() {

  drawClock();

  if (!rfid.PICC_IsNewCardPresent()) {
    delay(50);
    return;
  }

  if (!rfid.PICC_ReadCardSerial()) {
    return;
  }

  Serial.println();
  Serial.println("CARD SCANNED");

  Serial.print("CARD UID: ");

  for (byte i = 0; i < rfid.uid.size; i++) {

    if (rfid.uid.uidByte[i] < 0x10) {
      Serial.print("0");
    }

    Serial.print(rfid.uid.uidByte[i], HEX);
    Serial.print(" ");
  }

  Serial.println();

  bool studentFound = false;

  // Search student database
  for (int i = 0; i < NUM_STUDENTS; i++) {

    if (
      rfid.uid.size == 4 &&
      rfid.uid.uidByte[0] == students[i].uid[0] &&
      rfid.uid.uidByte[1] == students[i].uid[1] &&
      rfid.uid.uidByte[2] == students[i].uid[2] &&
      rfid.uid.uidByte[3] == students[i].uid[3]
    ) {

      studentFound = true;

      DateTime now = rtc.now();

      // Send the scanned UID to the website. Local attendance display
      // continues even if Wi-Fi or the website is temporarily unavailable.
      String uidHex = "";
      for (byte j = 0; j < rfid.uid.size; j++) {
        if (rfid.uid.uidByte[j] < 0x10) uidHex += "0";
        uidHex += String(rfid.uid.uidByte[j], HEX);
      }
      uidHex.toUpperCase();

      bool websiteAccepted = sendAttendanceToWebsite(uidHex);
      if (websiteAccepted) {
        Serial.println("WEBSITE: ATTENDANCE ACCEPTED");
      } else {
        Serial.println("WEBSITE: UPLOAD NOT CONFIRMED");
      }

      showAttendance(students[i], now);

      break;
    }
  }

  if (!studentFound) {
    showDenied();
  }

  // Release RFID card
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  delay(500);

  drawHomeScreen();
}

// =================================================
// 10. WI-FI AND WEBSITE ATTENDANCE UPLOAD
// =================================================

void connectToWiFi() {
  if (String(WIFI_SSID) == "YOUR_WIFI_NAME" ||
      String(WIFI_PASSWORD) == "YOUR_WIFI_PASSWORD") {
    Serial.println("Wi-Fi credentials not configured; running offline.");
    return;
  }

  Serial.print("Connecting to Wi-Fi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("Wi-Fi connected.");
    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println();
    Serial.println("Wi-Fi unavailable; attendance will continue locally.");
  }
}

bool sendAttendanceToWebsite(String uidHex) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("No Wi-Fi: attendance not uploaded.");
    return false;
  }

  if (String(DEVICE_SCAN_KEY) == "YOUR_SCAN_KEY" ||
      String(WEBSITE_SCAN_URL).indexOf("YOUR-PROJECT") >= 0 ||
      String(WIFI_SSID) == "YOUR_WIFI_NAME" ||
      String(WIFI_PASSWORD) == "YOUR_WIFI_PASSWORD") {
    Serial.println("Wi-Fi, website URL, or device key not configured.");
    return false;
  }

  // HTTPS client. setInsecure() is for initial testing only; it encrypts
  // traffic but does not verify the server certificate.
  WiFiClientSecure secureClient;
  secureClient.setInsecure();

  HTTPClient http;
  http.setTimeout(15000);

  if (!http.begin(secureClient, WEBSITE_SCAN_URL)) {
    Serial.println("Could not start HTTPS connection.");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-scan-key", DEVICE_SCAN_KEY);

  // This matches index.js: req.body.uid and req.body.device.
  String payload = "{\"uid\":\"" + uidHex +
                   "\",\"device\":\"" + String(DEVICE_ID) + "\"}";

  Serial.print("Sending attendance to website: ");
  Serial.println(payload);

  int httpCode = http.POST(payload);
  String response = http.getString();

  Serial.print("Website HTTP response: ");
  Serial.println(httpCode);
  Serial.print("Website reply: ");
  Serial.println(response);

  http.end();

  // The existing Express API returns {"ok":true,"name":"..."} on success.
  return (httpCode >= 200 && httpCode < 300 && response.indexOf("\\"ok\\":true") >= 0);
}

// =================================================
// 11. HOME SCREEN
// =================================================

void drawHomeScreen() {

  tft.fillScreen(BG_COLOR);

  tft.fillRect(0, 0, 320, 35, HEADER_COLOR);

  tft.setTextColor(WHITE_COLOR);
  tft.setTextSize(2);
  tft.setCursor(8, 10);
  tft.print("UENR ATTENDANCE");

  tft.setTextColor(CYAN_COLOR);
  tft.setTextSize(1);
  tft.setCursor(10, 48);
  tft.print("UENR SMART ATTENDANCE");

  tft.setTextColor(YELLOW_COLOR);
  tft.setTextSize(2);
  tft.setCursor(10, 75);
  tft.print("DATE / TIME");

  drawClock();

  tft.drawRoundRect(
    8, 150, 195, 55, 6, CYAN_COLOR
  );

  tft.setTextColor(WHITE_COLOR);
  tft.setTextSize(2);
  tft.setCursor(22, 170);
  tft.print("SCAN YOUR CARD");

  tft.drawRoundRect(
    215, 55, 98, 125, 6, YELLOW_COLOR
  );

  tft.setTextColor(YELLOW_COLOR);
  tft.setTextSize(1);
  tft.setCursor(230, 105);
  tft.print("CAMERA");
  tft.setCursor(232, 120);
  tft.print("READY");

  tft.setTextColor(GREY_COLOR);
  tft.setTextSize(1);
  tft.setCursor(8, 220);
  tft.print("UENR ROBOTICS CLUB");
}

// =================================================
// 11. LIVE CLOCK
// =================================================

void drawClock() {

  DateTime now = rtc.now();

  char dateString[16];
  char timeString[16];

  sprintf(
    dateString,
    "%02d/%02d/%04d",
    now.day(),
    now.month(),
    now.year()
  );

  sprintf(
    timeString,
    "%02d:%02d:%02d",
    now.hour(),
    now.minute(),
    now.second()
  );

  tft.fillRect(8, 98, 195, 40, BG_COLOR);

  tft.setTextColor(WHITE_COLOR);
  tft.setTextSize(2);
  tft.setCursor(10, 100);
  tft.print(timeString);

  tft.setTextSize(1);
  tft.setCursor(10, 125);
  tft.print(dateString);
}

// =================================================
// 12. FIND CAMERA JPEG HEADER
// =================================================

bool findJPGHeader() {

  const uint8_t header[4] = {
    'J', 'P', 'G', '1'
  };

  byte matched = 0;

  unsigned long startTime = millis();

  while (millis() - startTime < 10000) {

    if (CameraSerial.available()) {

      uint8_t receivedByte = CameraSerial.read();

      if (receivedByte == header[matched]) {

        matched++;

        if (matched == 4) {
          return true;
        }

      } else {

        matched = (receivedByte == header[0]) ? 1 : 0;

      }
    }
  }

  return false;
}

// =================================================
// 13. CAPTURE AND DISPLAY PHOTOGRAPH
// =================================================

bool captureAndDisplayPhoto() {

  Serial.println("Sending CAPTURE command...");

  // Ask camera to capture
  CameraSerial.println("CAPTURE");

  // Wait for JPG1 header
  if (!findJPGHeader()) {

    Serial.println("CAMERA RESPONSE TIMEOUT!");

    return false;
  }

  Serial.println("JPEG HEADER RECEIVED.");

  // Receive JPEG image size
  uint32_t imageSize = 0;

  size_t sizeReceived = CameraSerial.readBytes(
    (char*)&imageSize,
    sizeof(imageSize)
  );

  if (sizeReceived != sizeof(imageSize)) {

    Serial.println("FAILED TO RECEIVE IMAGE SIZE.");

    return false;
  }

  Serial.print("IMAGE SIZE: ");
  Serial.println(imageSize);

  // Check image size
  if (imageSize == 0 || imageSize > MAX_IMAGE_SIZE) {

    Serial.println("INVALID IMAGE SIZE.");

    return false;
  }

  // Allocate memory
  uint8_t *imageBuffer = (uint8_t*)malloc(imageSize);

  if (imageBuffer == nullptr) {

    Serial.println("IMAGE MEMORY ALLOCATION FAILED!");

    return false;
  }

  // Receive JPEG bytes
  size_t received = CameraSerial.readBytes(
    (char*)imageBuffer,
    imageSize
  );

  Serial.print("BYTES RECEIVED: ");
  Serial.println(received);

  if (received != imageSize) {

    Serial.println("INCOMPLETE PHOTOGRAPH!");

    free(imageBuffer);

    return false;
  }

  // Verify JPEG
  if (
    imageBuffer[0] != 0xFF ||
    imageBuffer[1] != 0xD8
  ) {

    Serial.println("JPEG VERIFICATION FAILED!");

    free(imageBuffer);

    return false;
  }

  Serial.println("PHOTOGRAPH RECEIVED SUCCESSFULLY!");
  Serial.println("JPEG IMAGE VERIFIED!");

  // Clear photograph area
  tft.fillRect(160, 40, 160, 200, BG_COLOR);

  Serial.println("DISPLAYING PHOTOGRAPH...");

  // Decode and display JPEG
  TJpgDec.drawJpg(
    160,
    45,
    imageBuffer,
    imageSize
  );

  Serial.println("PHOTOGRAPH DISPLAYED ON TFT!");

  free(imageBuffer);

  return true;
}

// =================================================
// 14. SUCCESSFUL ATTENDANCE
// =================================================

void showAttendance(Student student, DateTime now) {

  digitalWrite(RED_LED, LOW);
  digitalWrite(GREEN_LED, HIGH);

  tft.fillScreen(BG_COLOR);

  // Header
  tft.fillRect(0, 0, 320, 35, GREEN_COLOR);

  tft.setTextColor(ILI9341_BLACK);
  tft.setTextSize(2);
  tft.setCursor(12, 10);
  tft.print("ATTENDANCE OK");

  // Student name
  tft.setTextColor(WHITE_COLOR);
  tft.setTextSize(1);
  tft.setCursor(8, 55);
  tft.print("STUDENT NAME:");

  tft.setTextColor(GREEN_COLOR);
  tft.setTextSize(2);
  tft.setCursor(8, 72);
  tft.print(student.name);

  // Index number
  tft.setTextColor(WHITE_COLOR);
  tft.setTextSize(1);
  tft.setCursor(8, 112);
  tft.print("INDEX NUMBER:");

  tft.setTextColor(YELLOW_COLOR);
  tft.setTextSize(1);
  tft.setCursor(8, 130);
  tft.print(student.indexNumber);

  // Attendance time
  char timeString[16];

  sprintf(
    timeString,
    "%02d:%02d:%02d",
    now.hour(),
    now.minute(),
    now.second()
  );

  tft.setTextColor(CYAN_COLOR);
  tft.setTextSize(1);
  tft.setCursor(8, 165);
  tft.print("ATTENDANCE TIME:");

  tft.setTextColor(WHITE_COLOR);
  tft.setTextSize(2);
  tft.setCursor(8, 182);
  tft.print(timeString);

  // Date
  char dateString[16];

  sprintf(
    dateString,
    "%02d/%02d/%04d",
    now.day(),
    now.month(),
    now.year()
  );

  tft.setTextColor(WHITE_COLOR);
  tft.setTextSize(1);
  tft.setCursor(8, 215);
  tft.print(dateString);

  // Serial record
  Serial.println();
  Serial.println("ATTENDANCE SUCCESS");

  Serial.print("NAME: ");
  Serial.println(student.name);

  Serial.print("INDEX: ");
  Serial.println(student.indexNumber);

  displayDateTime(now);

  // Capture and display student photo
  bool photoSuccess = captureAndDisplayPhoto();

  if (!photoSuccess) {

    tft.drawRect(
      165, 45, 150, 130, RED_COLOR
    );

    tft.setTextColor(RED_COLOR);
    tft.setTextSize(1);
    tft.setCursor(185, 100);
    tft.print("PHOTO FAILED");

    Serial.println("ATTENDANCE SAVED WITHOUT PHOTO.");
  }

  delay(DISPLAY_DURATION);

  digitalWrite(GREEN_LED, LOW);
}

// =================================================
// 15. UNKNOWN CARD
// =================================================

void showDenied() {

  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, HIGH);

  tft.fillScreen(BG_COLOR);

  tft.fillRect(0, 0, 320, 40, RED_COLOR);

  tft.setTextColor(WHITE_COLOR);
  tft.setTextSize(2);
  tft.setCursor(35, 12);
  tft.print("ACCESS DENIED");

  tft.setTextColor(RED_COLOR);
  tft.setTextSize(2);
  tft.setCursor(55, 85);
  tft.print("UNKNOWN CARD");

  tft.setTextColor(WHITE_COLOR);
  tft.setTextSize(1);
  tft.setCursor(75, 125);
  tft.print("NOT REGISTERED");

  tft.drawRoundRect(
    75, 155, 170, 35, 5, RED_COLOR
  );

  tft.setCursor(112, 168);
  tft.print("TRY AGAIN");

  Serial.println("ATTENDANCE DENIED.");

  delay(DISPLAY_DURATION);

  digitalWrite(RED_LED, LOW);
}

// =================================================
// 16. SERIAL DATE AND TIME
// =================================================

void displayDateTime(DateTime now) {

  Serial.print("DATE: ");

  Serial.print(now.day());
  Serial.print("/");
  Serial.print(now.month());
  Serial.print("/");
  Serial.println(now.year());

  Serial.print("TIME: ");

  Serial.print(now.hour());
  Serial.print(":");
  Serial.print(now.minute());
  Serial.print(":");
  Serial.println(now.second());

  Serial.println("------------------------");
}
