// This loads the environment variables from the .env file
require('dotenv').load();

var restify = require('restify');
var builder = require('botbuilder');
var request = require('request');

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

// Create the dialog
bot.dialog('/', function (session) {
    if (session.message.text.length = 6 && !isNaN(session.message.text)) {        
        var mtaUrl = process.env.MTA_API + 'stop/MTA_' + session.message.text + '.json?key=' + process.env.MTA_KEY;
        request(mtaUrl, function (error, response, body) {
            // Make sure we have a vlid response
            if (!error && response.statusCode == 200) {
                var busInfo = JSON.parse(body);
                // Check that the bus stop asked for exists
                if (busInfo.code == 200) {                
                    var cards = getCardsAttachments(session, busInfo);
                    var reply = new builder.Message(session)
                        .attachmentLayout(builder.AttachmentLayout.carousel)
                        .attachments(cards);
                    session.send('Buses that stop at ' + busInfo.data.name + '...');
                    session.send(reply);
                } else {
                    session.send('No bus stop for that number sorry :/'); 
                }
            }
        });
    } else {
        session.send('Please enter a 6 digit bus stop number.');
    }   
});

//=========================================================
// Build cards for the carousel
//=========================================================

function getCardsAttachments(session, busInfo) {
    var cardArray = [];
    var numberOfBuses = busInfo.data.routes.length;
    var counter = 0;
    while (numberOfBuses > counter) {
        cardArray.push(
            new builder.ThumbnailCard(session)
                .title(busInfo.data.routes[counter].shortName)
                .subtitle(busInfo.data.routes[counter].longName)
                .text(busInfo.data.routes[counter].description)
                .buttons([
                    builder.CardAction.openUrl(session, busInfo.data.routes[counter].url, 'Timetable')
        ]));
        // Increment the counter
        counter++;
    }
    return cardArray;
}