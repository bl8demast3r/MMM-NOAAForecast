/*********************************

  Node Helper for MMM-NOAAForecast.

  This helper is responsible for the DarkSky-compatible data pull from NOAA.

  Sample API:

    e.g. https://api.weather.gov/points/40.8932469,-74.0116536

*********************************/

var NodeHelper = require("node_helper");
var needle = require("needle");
var moment = require("moment");

module.exports = NodeHelper.create({
  start: function () {
    console.log(
      `====================== Starting node_helper for module [${this.name}]`
    );
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "NOAA_CALL_FORECAST_GET") {
      var self = this;
      // use a browser-like User-Agent for requests
      var needleOptions = {
        follow_max: 3,
        headers: {
          "User-Agent": "MMM-NOAAForecast (MagicMirror/2.0)"
        }
      };

      if (
        payload.latitude === null ||
        payload.latitude === "" ||
        payload.longitude === null ||
        payload.longitude === ""
      ) {
        console.log(
          `[MMM-NOAAForecast] ${moment().format(
            "D-MMM-YY HH:mm"
          )} ** ERROR ** Latitude and/or longitude not provided.`
        );
      } else {
        var url = `https://api.weather.gov/points/${payload.latitude},${payload.longitude}`;

        console.log(`[MMM-NOAAForecast] Getting data: ${url}`);
        needle.get(url, needleOptions, function (error, response, body) {
          if (!error && response.statusCode === 200) {
            var forecastData = {};
            var parsedBody = typeof body === "string" ? JSON.parse(body) : body;
            var properties = parsedBody.properties;

            if (
              properties &&
              properties.forecast &&
              properties.forecastHourly /* && properties.forecastGridData */
            ) {
              var forecastUrls = [
                { key: "forecast", url: properties.forecast },
                { key: "forecastHourly", url: properties.forecastHourly },
                { key: "forecastGridData", url: properties.forecastGridData }
              ];

              if (payload.showAlerts !== false) {
                forecastUrls.push({
                  key: "alerts",
                  url: `https://api.weather.gov/alerts/active?point=${payload.latitude},${payload.longitude}`
                });
              }

              var totalRequests = forecastUrls.length + (properties.observationStations ? 1 : 0);
              var completedRequests = 0;

              function checkComplete() {
                completedRequests++;
                if (completedRequests >= totalRequests) {
                  self.sendSocketNotification("NOAA_CALL_FORECAST_DATA", {
                    instanceId: payload.instanceId,
                    payload: forecastData
                  });
                }
              }

              forecastUrls.forEach(function (item) {
                needle.get(item.url, needleOptions, function (err, res, data) {
                  if (!err && res.statusCode === 200) {
                    forecastData[item.key] = data;
                    console.log(`[MMM-NOAAForecast] Getting data: ${item.url}`);
                  } else {
                    console.log(
                      `[MMM-NOAAForecast] ${moment().format(
                        "D-MMM-YY HH:mm"
                      )} ** ERROR ** Failed to get ${item.key}: ${err}`
                    );
                  }
                  checkComplete();
                });
              });

              if (properties.observationStations) {
                needle.get(properties.observationStations, needleOptions, function (sErr, sRes, sData) {
                  if (!sErr && sRes.statusCode === 200) {
                    var sBody = typeof sData === "string" ? JSON.parse(sData) : sData;
                    var firstStation = sBody && sBody.features && sBody.features[0] ? sBody.features[0].id : null;
                    if (firstStation) {
                      needle.get(`${firstStation}/observations/latest`, needleOptions, function (oErr, oRes, oData) {
                        if (!oErr && oRes.statusCode === 200) {
                          forecastData["observation"] = typeof oData === "string" ? JSON.parse(oData) : oData;
                          console.log(`[MMM-NOAAForecast] Getting observation: ${firstStation}/observations/latest`);
                        }
                        checkComplete();
                      });
                    } else {
                      checkComplete();
                    }
                  } else {
                    checkComplete();
                  }
                });
              }
            } else {
              console.log(
                `[MMM-NOAAForecast] ${moment().format(
                  "D-MMM-YY HH:mm"
                )} ** ERROR ** Missing forecast URLs in response: ${
                  error ? error : JSON.stringify(parsedBody)
                }`
              );
            }
          } else {
            console.log(
              `[MMM-NOAAForecast] ${moment().format(
                "D-MMM-YY HH:mm"
              )} ** ERROR ** ${error}`
            );
          }
        });
      }
    }
  }
});
