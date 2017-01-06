// This loads the environment variables from the .env file
require('dotenv').load();

var restify = require('restify');
var builder = require('botbuilder');
var request = require('request');
var dateFormat = require('dateformat');
var locationDialog = require('./node_modules_customised/botbuilder-location');
var spanGeoForSearch = '0.005';
var boundingBoxForCard = 0.001;
var maxNumberOfStops = 5;
var currentPlace;
var busStopInfoArray;
var busStopRoutesArray;
var busStopRoutesArrayChoicesDetail;
var busInfo;
//var locationDialog = require('botbuilder-location');

//=========================================================
// Bot Setup
//=========================================================

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url); 
});
  
// Create chat bot
var connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});
var bot = new builder.UniversalBot(connector);
server.post('/api/messages', connector.listen());

//=========================================================
// Bots Dialogs
//=========================================================

// Set the maps API key
bot.library(locationDialog.createLibrary(process.env.BING_MAPS_API_KEY));

// Get the user's location
bot.dialog("/", [
    function (session) {
        builder.Prompts.choice(session, "Yo. Need a bus?", "y|n");
    },
    // Get location, or a quote of the day
    function (session, results) {
        if (results.response.entity == "y") {
            var options = {
                prompt: "OK, where are you at?", // "OK, where are you at? Try something like 'Park and 34th'."
                useNativeControl: true,
                reverseGeocode: true
            };
            locationDialog.getLocation(session, options);
        } else {
            request("http://quotes.rest/qod.json?category=inspire", function (error, response, body) {
                var qod = JSON.parse(body); 
                session.send(qod.contents.quotes[0].author + " says:");
                session.send(qod.contents.quotes[0].quote);
            });
            session.endDialog();
        }        
    },
    // Get bus stops
    function (session, results) {
        if (results.response) {
            // Get the location
            currentPlace = results.response;
            // Make sure the bus number makes sense  
            var mtaUrl = 
                process.env.MTA_API_WHERE + 'stops-for-location.json'
                + '?lat=' + currentPlace.geo.latitude 
                + '&lon=' + currentPlace.geo.longitude 
                + '&latSpan=' + spanGeoForSearch
                + '&lonSpan=' + spanGeoForSearch
                + '&key=' + process.env.MTA_API_KEY;
            request(mtaUrl, function (error, response, body) {
                // Make sure we have a valid response
                if (!error && response.statusCode == 200) {
                    var busStopInfo = JSON.parse(body);                    
                    // Check that the bus stop asked for exists
                    if (busStopInfo.code == 200 && busStopInfo.data.stops.length > 0) {   
                        // Send only the first closest few stops
                        busStopInfoArray = busStopInfo.data.stops;
                        busStopInfoArray.sort(compareDist);
                        // Render the cards             
                        var cards = getBusStopCardAttachments(session, busStopInfoArray);
                        var reply = new builder.Message(session)
                            .attachmentLayout(builder.AttachmentLayout.carousel)
                            .attachments(cards);
                        session.send(reply);
                        session.send('OK, that\'s your closest ' + (maxNumberOfStops < busStopInfoArray.length ? maxNumberOfStops : busStopInfoArray.length) + ' bus stops');
                        builder.Prompts.number(session, 'Which one you want? Just type the number.');
                    } else {
                        session.send('No NYC bus stops near you sorry boss :/'); 
                    }
                }
            });
        }
    },
    // Get routes for the stop
    function (session, results) {
        if (results.response) {
            busStopRoutesArray = busStopInfoArray[results.response].routes;
            var busStopRoutesArrayChoices = [];
            busStopRoutesArrayChoicesDetail = [];
            var counter = 0;
            while (busStopRoutesArray.length > counter) {
                busStopRoutesArrayChoices.push(
                    busStopRoutesArray[counter].shortName
                    );
                busStopRoutesArrayChoicesDetail.push({
                    shortName: busStopRoutesArray[counter].shortName,
                    monitoringRef: busStopInfoArray[results.response].code,
                    lineRef: busStopRoutesArray[counter].id
                    });
                // Increment the counter
                counter++;
            }
            builder.Prompts.choice(session, 'Cool. Which route you want?', busStopRoutesArrayChoices);
        }
    },
    // Get the next bus for that route; when it arrives here
    function (session, results) {
        if (results.response) {
            var counter = 0;
            while (busStopRoutesArrayChoicesDetail.length > counter) {
                if(busStopRoutesArrayChoicesDetail[counter].shortName == results.response.entity){
                    break;
                }
                // Increment the counter
                counter++;
            }                
            // Make sure the bus number makes sense  
            var mtaUrl = 
                process.env.MTA_API_SIRI + 'stop-monitoring.json'
                + "?MonitoringRef=" + busStopRoutesArrayChoicesDetail[counter].monitoringRef
                + "&LineRef=" + busStopRoutesArrayChoicesDetail[counter].lineRef
                + '&key=' + process.env.MTA_API_KEY;
            request(mtaUrl, function (error, response, body) {
                // Make sure we have a valid response
                if (!error && response.statusCode == 200) {
                    busInfo = JSON.parse(body);   
                    var arrivalTimesArray = busInfo.Siri.ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit;  
                    if (arrivalTimesArray.length > 0) {
                        if (arrivalTimesArray.length > 1) {
                            arrivalTimesArray.sort(compareTime);
                        }
                        if (typeof(arrivalTimesArray[0].MonitoredVehicleJourney.MonitoredCall.ExpectedArrivalTime) == "undefined") {
                            session.send('No departures scheduled for a while sorry chief.');
                        }
                        var expectedArrivalTime = new Date((arrivalTimesArray[0].MonitoredVehicleJourney.MonitoredCall.ExpectedArrivalTime).slice(0, -6));
                        session.send("Your next bus arrives at " + dateFormat(expectedArrivalTime, "UTC:h:MM TT Z").slice(0, -4));
                    } else {
                        session.send('No departures scheduled for a while sorry chief.');
                    }                                                            
                } else {
                    session.send('Houston, we have a problem - relaunching.');
                }
            });            
        }
    }   
]);

//=========================================================
// Build bus stop cards for the carousel
//=========================================================

function getBusStopCardAttachments(session, busStopInfoArray, place) {
    var cardArray = [];
    var numberOfBusStops = busStopInfoArray.length;
    var counter = 0;
    while (numberOfBusStops > counter && maxNumberOfStops > counter) {
        cardArray.push(
            new builder.HeroCard(session)
                .subtitle((counter + 1) + '. ' + busStopInfoArray[counter].name)
                .images([{
                    url: process.env.BING_MAPS_API
                        + '?mapArea=' 
                            + (busStopInfoArray[counter].lat - boundingBoxForCard) + ',' 
                            + (busStopInfoArray[counter].lon - boundingBoxForCard) + ',' 
                            + (busStopInfoArray[counter].lat + boundingBoxForCard) + ','
                            + (busStopInfoArray[counter].lon + boundingBoxForCard)
                        + '&mapSize=500,280'
                        + '&pp=' 
                            + busStopInfoArray[counter].lat + ',' 
                            + busStopInfoArray[counter].lon 
                            + ';1;' 
                            + (counter + 1)
                        + '&dpi=1'
                        + '&logo=always'
                        + '&form=BTCTRL'
                        + '&key=' + process.env.BING_MAPS_API_KEY
                }]));
        // Increment the counter
        counter++;
    }
    return cardArray;
}

//=========================================================
// Compare function for geo-coordinates
//=========================================================

function compareDist(a, b) {
    // Get distance from currentPlace for a
    distanceXForA = a.lat - currentPlace.geo.latitude;
    distanceYForA = a.lon - currentPlace.geo.longitude;
    totalDistanceFromPlaceForA = Math.sqrt((distanceXForA * distanceXForA) + (distanceYForA * distanceYForA));
    // Get distance from currentPlace for b
    distanceXForB = b.lat - currentPlace.geo.latitude;
    distanceYForB = b.lon - currentPlace.geo.longitude;
    totalDistanceFromPlaceForB = Math.sqrt((distanceXForB * distanceXForB) + (distanceYForB * distanceYForB));
    // Return the shortest distance
    if (totalDistanceFromPlaceForA < totalDistanceFromPlaceForB)
        return -1;
    if (totalDistanceFromPlaceForA > totalDistanceFromPlaceForB)
        return 1;
    return 0;
}

//=========================================================
// Compare function for date/time
//=========================================================

function compareTime(a, b) {
    // Return the shortest time
    var timeFromStopA = new Date(typeof(a.MonitoredVehicleJourney.MonitoredCall.ExpectedArrivalTime) == "undefined" ? 8640000000000000 : a.MonitoredVehicleJourney.MonitoredCall.ExpectedArrivalTime);
    var timeFromStopB = new Date(typeof(b.MonitoredVehicleJourney.MonitoredCall.ExpectedArrivalTime) == "undefined" ? 8640000000000000 : b.MonitoredVehicleJourney.MonitoredCall.ExpectedArrivalTime);
    if (timeFromStopA < timeFromStopB)
        return -1;
    if (timeFromStopA > timeFromStopB)
        return 1;
    return 0;
}