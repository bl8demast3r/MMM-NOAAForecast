/**
 * Unit tests for Weather Alerts functionality in MMM-NOAAForecast
 */

const moment = require("moment");

global.moment = moment;

global.Module = {
  register: jest.fn((moduleName, moduleDefinition) => {
    global.MMM_NOAAForecast = moduleDefinition;
  })
};

global.config = {
  units: "imperial"
};

global.Log = {
  info: jest.fn(),
  log: jest.fn(),
  error: jest.fn()
};

require("../MMM-NOAAForecast.js");

describe("Weather Alerts Tests", () => {
  let module;

  beforeEach(() => {
    module = Object.create(global.MMM_NOAAForecast);
    module.config = {
      ...global.MMM_NOAAForecast.defaults,
      units: "imperial",
      showAlerts: true,
      maxAlertsToShow: 0,
      showSummary: true,
      useAnimatedIcons: false
    };
    module.identifier = "test_module_alerts";
    module.clearIcons = jest.fn();
    module.sendSocketNotification = jest.fn();
    module.sendNotification = jest.fn();
    module.updateDom = jest.fn();
    module.file = jest.fn((path) => `/modules/MMM-NOAAForecast/${path}`);
    module.translate = jest.fn((key) => key);
  });

  function createBaseWeatherData() {
    const now = moment();
    return {
      hourly: [
        {
          startTime: now.format(),
          temperature: 68,
          temperatureUnit: "F",
          icon: "https://api.weather.gov/icons/land/day/sct",
          windSpeed: "10",
          windDirection: "NW",
          windGust: "15",
          relativeHumidity: { value: 50 },
          feelsLike: 68
        }
      ],
      daily: [
        {
          startTime: now.format(),
          temperature: 70,
          maxTemperature: "75",
          minTemperature: "55",
          shortForecast: "Sunny",
          detailedForecast: "Sunny with high near 75.",
          windSpeed: "10 mph"
        }
      ],
      alerts: []
    };
  }

  describe("Defaults and Configuration", () => {
    it("should have showAlerts enabled by default", () => {
      expect(global.MMM_NOAAForecast.defaults.showAlerts).toBe(true);
    });

    it("should have maxAlertsToShow set to 0 by default", () => {
      expect(global.MMM_NOAAForecast.defaults.maxAlertsToShow).toBe(0);
    });

    it("should include maxAlertsToShow in sanitizeNumbers", () => {
      module.config.maxAlertsToShow = "5";
      module.sanitizeNumbers(["maxAlertsToShow"]);
      expect(module.config.maxAlertsToShow).toBe(5);
    });

    it("should send showAlerts flag in getData()", () => {
      module.config.latitude = "40.7128";
      module.config.longitude = "-74.0060";
      module.config.showAlerts = true;

      module.getData();

      expect(module.sendSocketNotification).toHaveBeenCalledWith(
        "NOAA_CALL_FORECAST_GET",
        expect.objectContaining({
          latitude: "40.7128",
          longitude: "-74.0060",
          showAlerts: true
        })
      );
    });
  });

  describe("socketNotificationReceived alert handling", () => {
    function createMockSocketPayload(alertsPayload) {
      return {
        instanceId: "test_module_alerts",
        payload: {
          forecast: {
            properties: {
              periods: [
                {
                  startTime: moment().format(),
                  temperature: 70,
                  shortForecast: "Sunny",
                  detailedForecast: "Sunny.",
                  maxTemperature: "75",
                  minTemperature: "55"
                }
              ]
            }
          },
          forecastHourly: {
            properties: {
              periods: [
                {
                  startTime: moment().format(),
                  temperature: 68,
                  feelsLike: 68,
                  icon: "https://api.weather.gov/icons/land/day/sct",
                  relativeHumidity: { value: 50 },
                  windSpeed: "10 mph",
                  windDirection: "NW"
                }
              ]
            }
          },
          forecastGridData: { properties: {} },
          alerts: alertsPayload
        }
      };
    }

    it("should parse GeoJSON FeatureCollection alerts correctly", () => {
      const mockPayload = createMockSocketPayload({
        type: "FeatureCollection",
        features: [
          {
            id: "urn:oid:alert-1",
            properties: {
              event: "Flood Watch",
              headline: "Flood Watch issued",
              description: "Flooding is possible in low-lying areas.",
              senderName: "NWS Upton NY"
            }
          }
        ]
      });

      module.socketNotificationReceived("NOAA_CALL_FORECAST_DATA", mockPayload);

      expect(module.weatherData.alerts).toHaveLength(1);
      expect(module.weatherData.alerts[0].properties.event).toBe("Flood Watch");
    });

    it("should handle alerts passed as JSON string", () => {
      const mockPayload = createMockSocketPayload(
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              id: "urn:oid:alert-string",
              properties: {
                event: "Wind Advisory",
                headline: "Wind Advisory in effect",
                description: "High winds expected.",
                senderName: "NWS Upton NY"
              }
            }
          ]
        })
      );

      module.socketNotificationReceived("NOAA_CALL_FORECAST_DATA", mockPayload);

      expect(module.weatherData.alerts).toHaveLength(1);
      expect(module.weatherData.alerts[0].properties.event).toBe("Wind Advisory");
    });

    it("should handle missing or malformed alerts gracefully", () => {
      const mockPayload = createMockSocketPayload(undefined);

      module.socketNotificationReceived("NOAA_CALL_FORECAST_DATA", mockPayload);

      expect(module.weatherData.alerts).toEqual([]);
    });
  });

  describe("processWeatherData Alert Formatting", () => {
    it("should format NOAA GeoJSON alerts matching OpenWeather structure", () => {
      module.weatherData = createBaseWeatherData();
      module.weatherData.alerts = [
        {
          id: "alert-1",
          properties: {
            event: "Severe Thunderstorm Warning",
            headline: "Severe Thunderstorm Warning issued for Hudson County",
            description: "A severe thunderstorm capable of producing 60 mph wind gusts is near Jersey City.",
            senderName: "NWS New York NY",
            severity: "Severe",
            urgency: "Immediate",
            certainty: "Observed"
          }
        }
      ];

      const result = module.processWeatherData();

      expect(result.alerts).toHaveLength(1);
      const alert = result.alerts[0];
      expect(alert.event).toBe("Severe Thunderstorm Warning");
      expect(alert.description).toBe("A severe thunderstorm capable of producing 60 mph wind gusts is near Jersey City.");
      expect(alert.sender_name).toBe("NWS New York NY");
      expect(alert.senderName).toBe("NWS New York NY");
      expect(alert.severity).toBe("Severe");
    });

    it("should support plain/flat alert objects", () => {
      module.weatherData = createBaseWeatherData();
      module.weatherData.alerts = [
        {
          id: "alert-plain",
          event: "Winter Storm Watch",
          description: "Heavy snow possible.",
          sender_name: "NWS Mount Holly NJ"
        }
      ];

      const result = module.processWeatherData();

      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0].event).toBe("Winter Storm Watch");
      expect(result.alerts[0].description).toBe("Heavy snow possible.");
      expect(result.alerts[0].sender_name).toBe("NWS Mount Holly NJ");
    });

    it("should deduplicate alerts with the same ID or title and description", () => {
      module.weatherData = createBaseWeatherData();
      module.weatherData.alerts = [
        {
          id: "alert-dup-1",
          properties: {
            event: "Coastal Flood Advisory",
            description: "Minor coastal flooding expected.",
            senderName: "NWS Upton NY"
          }
        },
        {
          id: "alert-dup-1",
          properties: {
            event: "Coastal Flood Advisory",
            description: "Minor coastal flooding expected.",
            senderName: "NWS Upton NY"
          }
        }
      ];

      const result = module.processWeatherData();

      expect(result.alerts).toHaveLength(1);
    });

    it("should fallback to headline if description is missing or empty", () => {
      module.weatherData = createBaseWeatherData();
      module.weatherData.alerts = [
        {
          id: "alert-no-desc",
          properties: {
            event: "Special Weather Statement",
            headline: "Strong storms possible this afternoon",
            description: "",
            senderName: "NWS Upton NY"
          }
        }
      ];

      const result = module.processWeatherData();

      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0].description).toBe("Strong storms possible this afternoon");
    });

    it("should return empty alerts array when showAlerts is false", () => {
      module.config.showAlerts = false;
      module.weatherData = createBaseWeatherData();
      module.weatherData.alerts = [
        {
          id: "alert-1",
          properties: {
            event: "High Wind Warning",
            description: "High winds expected.",
            senderName: "NWS"
          }
        }
      ];

      const result = module.processWeatherData();

      expect(result.alerts).toEqual([]);
    });

    it("should limit alerts when maxAlertsToShow is set", () => {
      module.config.maxAlertsToShow = 2;
      module.weatherData = createBaseWeatherData();
      module.weatherData.alerts = [
        { id: "a1", properties: { event: "Alert 1", description: "Desc 1" } },
        { id: "a2", properties: { event: "Alert 2", description: "Desc 2" } },
        { id: "a3", properties: { event: "Alert 3", description: "Desc 3" } }
      ];

      const result = module.processWeatherData();

      expect(result.alerts).toHaveLength(2);
      expect(result.alerts[0].event).toBe("Alert 1");
      expect(result.alerts[1].event).toBe("Alert 2");
    });

    it("should handle weatherData without alerts property without throwing", () => {
      module.weatherData = createBaseWeatherData();
      delete module.weatherData.alerts;

      const result = module.processWeatherData();

      expect(result.alerts).toEqual([]);
    });
  });

  describe("Template Data Integration", () => {
    it("should expose forecast.alerts through getTemplateData()", () => {
      module.formattedWeatherData = {
        currently: {},
        summary: "Partly Cloudy",
        alerts: [
          {
            event: "Tornado Watch",
            description: "Tornado watch in effect.",
            sender_name: "NWS Storm Prediction Center"
          }
        ]
      };

      const templateData = module.getTemplateData();

      expect(templateData.forecast.alerts).toBeDefined();
      expect(templateData.forecast.alerts).toHaveLength(1);
      expect(templateData.forecast.alerts[0].event).toBe("Tornado Watch");
      expect(templateData.config.showAlerts).toBe(true);
    });
  });
});
