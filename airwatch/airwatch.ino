#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <U8g2lib.h>
#include <MQUnifiedsensor.h>

// ===== WIFI CREDENTIALS =====
#define WIFI_SSID "shuu"
#define WIFI_PASSWORD "shuvetha"

// ===== THINGSPEAK =====
#define THINGSPEAK_API_KEY "1QVSA9CMWGC99F1P"  // <-- paste your Write API Key here
#define THINGSPEAK_CHANNEL_ID "3394657"  // <-- paste your Channel ID here
String tsURL = "http://api.thingspeak.com/update?api_key=";

// ===== PIN DEFINITIONS =====
#define DHT_PIN 4
#define DHT_TYPE DHT11
#define MQ_PIN 34

// ===== MQ2 SETUP =====
#define BOARD "ESP32"
#define VOLTAGE_RESOLUTION 3.3
#define ADC_RESOLUTION 12
#define MQ_TYPE "MQ-2"
#define RATIO_MQ2_CLEAN_AIR 9.83

// ===== OLED SETUP =====
U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE);

// ===== DHT SETUP =====
DHT dht(DHT_PIN, DHT_TYPE);

// ===== MQ SETUP =====
MQUnifiedsensor MQ2(BOARD, VOLTAGE_RESOLUTION, ADC_RESOLUTION, MQ_PIN, MQ_TYPE);

unsigned long lastUpload = 0;
const long uploadInterval = 20000; // upload every 20 seconds

// ===== AQI CALCULATION ENGINE =====
int calculateRealAQI(float ppm) {
  if (ppm < 0) return 0;
  
  struct Breakpoint {
    float cLow;
    float cHigh;
    int iLow;
    int iHigh;
  };
  
  Breakpoint bp[] = {
    {0, 150, 0, 50},
    {150, 350, 51, 100},
    {350, 600, 101, 150},
    {600, 1000, 151, 200},
    {1000, 2000, 201, 300},
    {2000, 5000, 301, 500}
  };
  
  float aqi = 0;
  if (ppm > 5000) {
    aqi = 500 + ((ppm - 5000) / 1000.0) * 50;
    return (int)round(min(aqi, 999.0f));
  }
  
  for (int i = 0; i < 6; i++) {
    if (ppm >= bp[i].cLow && ppm <= bp[i].cHigh) {
      aqi = ((bp[i].iHigh - bp[i].iLow) / (bp[i].cHigh - bp[i].cLow)) * (ppm - bp[i].cLow) + bp[i].iLow;
      break;
    }
  }
  return (int)round(aqi);
}

String getAQICategory(int aqi) {
  if (aqi <= 50) return "GOOD";
  if (aqi <= 100) return "MODERATE";
  if (aqi <= 150) return "SENSITIVE";
  if (aqi <= 200) return "UNHEALTHY";
  if (aqi <= 300) return "VERY UNH.";
  return "HAZARDOUS";
}

void setup() {
  Serial.begin(115200);

  // Init OLED
  u8g2.begin();
  u8g2.setFont(u8g2_font_ncenB08_tr);

  // Init DHT
  dht.begin();

  // Init MQ2
  MQ2.setRegressionMethod(1);
  MQ2.setA(574.25);
  MQ2.setB(-2.222);
  MQ2.init();

  // Calibrate MQ2
  u8g2.clearBuffer();
  u8g2.drawStr(0, 20, "Calibrating MQ2...");
  u8g2.sendBuffer();

  float calcR0 = 0;
  for (int i = 1; i <= 10; i++) {
    MQ2.update();
    calcR0 += MQ2.calibrate(RATIO_MQ2_CLEAN_AIR);
  }
  MQ2.setR0(9.83);

  // Connect WiFi
  u8g2.clearBuffer();
  u8g2.drawStr(0, 20, "Connecting WiFi...");
  u8g2.sendBuffer();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    u8g2.clearBuffer();
    u8g2.drawStr(0, 20, "WiFi Connected!");
    u8g2.drawStr(0, 40, WiFi.localIP().toString().c_str());
    u8g2.sendBuffer();
    delay(2000);
  } else {
    u8g2.clearBuffer();
    u8g2.drawStr(0, 20, "WiFi Failed!");
    u8g2.drawStr(0, 40, "Running offline");
    u8g2.sendBuffer();
    delay(2000);
  }
}

void loop() {
  // Read sensors
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();

  MQ2.update();
  float gasValue = MQ2.readSensor();

  // Handle DHT read failure
  if (isnan(temperature)) temperature = 0;
  if (isnan(humidity)) humidity = 0;

  // Calculate EPA-aligned AQI and Category
  int aqiVal = calculateRealAQI(gasValue);
  String aqiStatus = getAQICategory(aqiVal);

  // Display on OLED
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);

  u8g2.drawStr(0, 12, "Air Quality Monitor");
  u8g2.drawLine(0, 14, 128, 14);

  String gasStr = "Gas: " + String(gasValue, 0) + " ppm";
  String tempStr = "Temp: " + String(temperature, 1) + " C";
  String humStr = "Hum: " + String(humidity, 1) + "%";
  String statusStr = "AQI: " + String(aqiVal) + " (" + aqiStatus + ")";

  u8g2.drawStr(0, 28, gasStr.c_str());
  u8g2.drawStr(0, 40, tempStr.c_str());
  u8g2.drawStr(0, 52, humStr.c_str());
  u8g2.drawStr(0, 63, statusStr.c_str());

  u8g2.sendBuffer();

  // Upload to ThingSpeak every 20 seconds
  unsigned long now = millis();
  if (WiFi.status() == WL_CONNECTED && now - lastUpload >= uploadInterval) {
    HTTPClient http;
String url = tsURL + THINGSPEAK_API_KEY +
             "&field1=" + String((int)gasValue) +
             "&field2=" + String(temperature, 1) +
             "&field3=" + String(humidity, 1);
Serial.println("Sending to ThingSpeak...");
Serial.println(url);
http.begin(url);
int httpCode = http.GET();
Serial.print("HTTP Response: ");
Serial.println(httpCode);
http.end();
lastUpload = now;
  }

  delay(2000);
}