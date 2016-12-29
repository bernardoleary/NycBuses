// This loads the environment variables from the .env file
require('dotenv').load();

var restify = require('restify');
var builder = require('botbuilder');
var request = require('request');
var locationDialog = require('./node_modules_customised/botbuilder-location');
var spanGeoForSearch = '0.003';
var boundingBoxForCard = 0.001;
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
            prompt: "Where you at boss? Try something like 'Park and 34th' or just send location",
            useNativeControl: true,
            reverseGeocode: true
        };
        locationDialog.getLocation(session, options);
    },
    // Get bus stops
    function (session, results) {
        if (results.response) {
            // Get the location
            var place = results.response;
            // Make sure the bus number makes sense  
            var mtaUrl = 
                process.env.MTA_API + 'stops-for-location.json'
                + '?lat=' + place.geo.latitude 
                + '&lon=' + place.geo.longitude 
                + '&latSpan=' + spanGeoForSearch
                + '&lonSpan=' + spanGeoForSearch
                + '&key=' + process.env.MTA_API_KEY;
            request(mtaUrl, function (error, response, body) {
                // Make sure we have a valid response
                if (!error && response.statusCode == 200) {
                    var busStopInfo = JSON.parse(body);
                    // Check that the bus stop asked for exists
                    if (busStopInfo.code == 200 && busStopInfo.data.stops > 0) {                
                        var cards = getBusStopCardAttachments(session, busStopInfo);
                        var reply = new builder.Message(session)
                            .attachmentLayout(builder.AttachmentLayout.carousel)
                            .attachments(cards);
                        session.send('OK boss, closest ' + busStopInfo.data.stops.length + ' bus stops are...');
                        session.send(reply);
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

function getBusStopCardAttachments(session, busStopInfo) {
    var cardArray = [];
    var numberOfBusStops = busStopInfo.data.stops.length;
    var counter = 0;
    while (numberOfBusStops > counter) {
        cardArray.push(
            new builder.HeroCard(session)
                .subtitle((counter + 1) + '. ' + busStopInfo.data.stops[counter].name)
                .images([{
                    url: process.env.BING_MAPS_API
                        + '?mapArea=' 
                            + (busStopInfo.data.stops[counter].lat - boundingBoxForCard) + ',' 
                            + (busStopInfo.data.stops[counter].lon - boundingBoxForCard) + ',' 
                            + (busStopInfo.data.stops[counter].lat + boundingBoxForCard) + ','
                            + (busStopInfo.data.stops[counter].lon + boundingBoxForCard)
                        + '&mapSize=500,280'
                        + '&pp=' 
                            + busStopInfo.data.stops[counter].lat + ',' 
                            + busStopInfo.data.stops[counter].lon 
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