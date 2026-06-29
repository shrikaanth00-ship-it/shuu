#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>

// ============================================
// CONFIGURATION (Update with your credentials)
// ============================================
const char* ssid = "YOUR_WIFI_SSID";          // Your WiFi SSID
const char* password = "YOUR_WIFI_PASSWORD";  // Your WiFi Password

// ThingSpeak Write API Config
const char* serverName = "http://api.thingspeak.com/update";
const char* writeAPIKey = "YOUR_THINGSPEAK_WRITE_API_KEY"; // Your ThingSpeak Write API Key

// ============================================
// HARDWARE PIN ASSIGNMENTS
// ============================================
#define MQ2_PIN 34       // Analog input pin for MQ-2 Gas Sensor (ADC1_CH6)
#define DHT_PIN 4        // Digital input pin for DHT11 Sensor
#define DHT_TYPE DHT11   // DHT 11 type

#define SCREEN_WIDTH 128 // OLED display width, in pixels
#define SCREEN_HEIGHT 64 // OLED display height, in pixels
#define OLED_RESET     -1 // Reset pin # (or -1 if sharing Arduino reset pin)

// Initialize sensors & display instances
DHT dht(DHT_PIN, DHT_TYPE);
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// Timing variables
unsigned long lastTime = 0;
const unsigned long timerDelay = 20000; // Update ThingSpeak every 20 seconds (ThingSpeak free limit is 15s)

void setup() {
  Serial.begin(115200);
  
  // Initialize DHT11
  dht.begin();
  
  // Initialize MQ-2 pin
  pinMode(MQ2_PIN, INPUT);

  // Initialize OLED Display
  // Address 0x3C is standard for 128x64 OLEDs
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { 
    Serial.println(F("SSD1306 allocation failed"));
    for(;;); // Don't proceed, loop forever
  }
  display.clearDisplay();
  display.setTextColor(WHITE);
  display.setTextSize(1);
  display.setCursor(0,0);
  display.println("AirWatch System");
  display.println("Initialising...");
  display.display();

  // Connect to WiFi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  display.println("Connecting WiFi...");
  display.display();
  
  while(WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("");
  Serial.print("Connected to WiFi network with IP Address: ");
  Serial.println(WiFi.localIP());
  
  display.clearDisplay();
  display.setCursor(0,0);
  display.println("System Live!");
  display.print("IP: ");
  display.println(WiFi.localIP());
  display.display();
  delay(2000);
}

void loop() {
  // Read DHT11 Temperature & Humidity
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  // Check if any reads failed
  if (isnan(h) || isnan(t)) {
    Serial.println("Failed to read from DHT sensor!");
    t = 0.0;
    h = 0.0;
  }

  // Read MQ-2 gas sensor
  int rawADC = analogRead(MQ2_PIN);
  
  // Convert 12-bit ESP32 ADC (0-4095) to ppm (parts per million)
  // Mapping to a baseline of 100ppm up to a max threshold of 3000ppm
  float gasPPM = (rawADC / 4095.0) * 3000.0;
  if (gasPPM < 100.0) gasPPM = 100.0; // Baseline ambient clean air level

  // Print values to Serial Monitor
  Serial.print("Gas PPM: ");
  Serial.print(gasPPM);
  Serial.print(" | Temp: ");
  Serial.print(t);
  Serial.print("C | Hum: ");
  Serial.print(h);
  Serial.println("%");

  // Update OLED Display
  display.clearDisplay();
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.println("--- AIRWATCH LIVE ---");
  
  display.setCursor(0, 16);
  display.setTextSize(1);
  display.print("Gas Level: ");
  display.setTextSize(2);
  display.print((int)gasPPM);
  display.setTextSize(1);
  display.println(" ppm");

  display.setCursor(0, 36);
  display.print("Temp: ");
  display.print(t, 1);
  display.write(167); // Degree symbol
  display.println("C");

  display.setCursor(0, 48);
  display.print("Humidity: ");
  display.print(h, 1);
  display.println("%");

  display.display();

  // Send telemetry payload to ThingSpeak every 20 seconds
  if ((millis() - lastTime) > timerDelay) {
    if(WiFi.status() == WL_CONNECTED){
      WiFiClient client;
      HTTPClient http;
      
      // Construct ThingSpeak update URL
      // field1: MQ-2 Gas PPM
      // field2: DHT11 Temperature
      // field3: DHT11 Humidity
      String url = String(serverName) + "?api_key=" + writeAPIKey + 
                   "&field1=" + String(gasPPM, 1) + 
                   "&field2=" + String(t, 1) + 
                   "&field3=" + String(h, 1);
      
      http.begin(client, url);
      int httpResponseCode = http.GET();
      
      if (httpResponseCode > 0) {
        Serial.print("ThingSpeak Uplink Code: ");
        Serial.println(httpResponseCode);
      } else {
        Serial.print("ThingSpeak Uplink Error: ");
        Serial.println(httpResponseCode);
      }
      // Free resources
      http.end();
    } else {
      Serial.println("WiFi Disconnected. Reconnecting...");
      WiFi.begin(ssid, password);
    }
    lastTime = millis();
  }
  
  delay(1000); // Main loop runs once per second
}
