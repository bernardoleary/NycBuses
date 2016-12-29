// This loads the environment variables from the .env file
require('dotenv').load();

var restify = require('restify');
var builder = require('botbuilder');
var request = require('request');
var locationDialog = require('./node_modules_customised/botbuilder-location');
var spanGeoForSearch = '0.005';
var boundingBoxForCard = 0.001;
var maxNumberOfStops = 5;
var currentPlace;
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
    // Get location
    function (session) {
        var options = {
            prompt: "Where are you at boss? Try something like 'Park and 34th'.",
            useNativeControl: true,
            reverseGeocode: true
        };
        locationDialog.getLocation(session, options);
    },
    // Get bus stops
    function (session, results) {
        if (results.response) {
            // Get the location
            currentPlace = results.response;
            // Make sure the bus number makes sense  
            var mtaUrl = 
                process.env.MTA_API + 'stops-for-location.json'
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
                        var busStopInfoArray = busStopInfo.data.stops;
                        busStopInfoArray.sort(compare);
                        // Render the cards             
                        var cards = getBusStopCardAttachments(session, busStopInfoArray);
                        var reply = new builder.Message(session)
                            .attachmentLayout(builder.AttachmentLayout.carousel)
                            .attachments(cards);
                        session.send(reply);
                        session.send('OK, that\'s your closest ' + (maxNumberOfStops < busStopInfoArray.length ? maxNumberOfStops : busStopInfoArray.length) + ' bus stops');
                    } else {
                        session.send('No NYC bus stops near you sorry boss :/'); 
                    }
                }
            });
        }  
    }
]);

//=========================================================
// Build cards for the carousel
// TODO: can put a link on the bus button to say click to see when next one arrives
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

function compare(a, b) {
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