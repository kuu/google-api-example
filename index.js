'use strict';

var config = require('config'),
    path = require('path'),
    express = require('express'),
    session = require('express-session'),
    google = require('googleapis');

var app = express(),
    port = process.env.PORT || config.server.port,
    DOC_ROOT = path.join(__dirname, 'www'),
    DOC_PATH = path.join(DOC_ROOT, 'index.html'),
    OAuth2Client = google.auth.OAuth2,
    plus = google.plus('v1'),
    oauth2Client = new OAuth2Client(
      config.google.client_id,
      config.google.client_secret,
      config.google.redirect_host + config.google.redirect_path
    );

app.use(session({
    secret: config.session.secret,
    saveUninitialized: true,
    resave: true
}));

// Redirect the user to Google for authentication.  When complete, Google
// will redirect the user back to the application at the url specified  as redirect_url.
app.get('/auth/google/login', function (req, res) {
  //console.log('GET /auth/google/login');

  var url = oauth2Client.generateAuthUrl({
    access_type: 'offline', // will return a refresh token
    scope: config.google.scope // can be a space-delimited string or an array of scopes
  });

  res.redirect(url);
});

// Google will redirect the user to this URL after authentication.  Finish
// the process by verifying the assertion.  If valid, the user will be
// logged in.  Otherwise, authentication has failed.
app.get(config.google.redirect_path, function (req, res) {
  var code = decodeURIComponent(req.query.code);

  //console.log('GET /auth/google/callback');

  oauth2Client.getToken(code, function(err, tokens) {
    // set tokens to the client
    // TODO: tokens should be set by OAuth2 client.
    if (err) {
      res.status(404);
    } else {
      oauth2Client.setCredentials(tokens);
      req.session.loggedIn = true;
      res.redirect('/');
    }
  });
});


app.get('/', function (req, res) {
  //console.log('GET /');

  if (req.session.loggedIn) {
    // retrieve user profile
    plus.people.get({ userId: 'me', auth: oauth2Client }, function (err, profile) {
      if (err) {
        res.send('Who are you?');
      } else {
        res.send('Hello ' + profile.displayName + '!');
      }
    });
  } else {
    res.sendFile(DOC_PATH);
  }
});

// Start server
if (require.main === module) {
  console.log('Server listening on port %s', port);
  app.listen(port);
}

module.exports = app;
