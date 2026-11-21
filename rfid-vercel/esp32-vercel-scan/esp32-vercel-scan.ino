// ESP32 + MFRC522 -> sends each scan to your Vercel website.
// Wiring (same as before): SDA/SS=5, SCK=18, MOSI=23, MISO=19, RST=22, 3.3V, GND.
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>

// ====== CHANGE THESE FIVE LINES ======
const char* WIFI_SSID   = "YOUR_WIFI_NAME";          // must be a 2.4 GHz network
const char* WIFI_PASS   = "YOUR_WIFI_PASSWORD";
const char* SCAN_URL    = "https://YOUR-PROJECT.vercel.app/api/scan";
const char* SCAN_KEY    = "YOUR_SCAN_KEY";           // same value as SCAN_KEY on Vercel
const char* DEVICE_NAME = "Gate 1";
// =====================================

#define SS_PIN  5
#define RST_PIN 22
MFRC522 rfid(SS_PIN, RST_PIN);

String lastUid = "";
unsigned long lastScanMs = 0;

bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting to Wi-Fi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Connected. IP: ");
    Serial.println(WiFi.localIP());
    return true;
  }
  Serial.println("Wi-Fi failed. Will try again on the next scan.");
  return false;
}

// Card number as UPPERCASE hex with no spaces, e.g. A1B2C3D4
String readUid() {
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  return uid;
}

void sendScan(const String& uid) {
  if (!connectWifi()) return;

  WiFiClientSecure client;
  client.setInsecure();            // simple HTTPS without checking the certificate

  HTTPClient http;
  http.setTimeout(15000);
  if (!http.begin(client, SCAN_URL)) {
    Serial.println("Could not start the request");
    return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Scan-Key", SCAN_KEY);

  String body = "{\"uid\":\"" + uid + "\",\"device\":\"" + String(DEVICE_NAME) + "\"}";
  int code = http.POST(body);

  Serial.print("Card ");
  Serial.print(uid);
  Serial.print(" -> HTTP ");
  Serial.println(code);
  if (code > 0) {
    Serial.println(http.getString());
  } else {
    Serial.println(http.errorToString(code));
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(500);
  SPI.begin(18, 19, 23, 5);        // SCK, MISO, MOSI, SS
  rfid.PCD_Init();
  connectWifi();
  Serial.println("Ready. Tap a card.");
}

void loop() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
    delay(50);
    return;
  }
  String uid = readUid();
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  // Ignore the same card for 3 seconds so one tap is not sent twice
  if (uid == lastUid && millis() - lastScanMs < 3000) return;
  lastUid = uid;
  lastScanMs = millis();

  sendScan(uid);
}
