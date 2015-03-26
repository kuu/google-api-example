'use strict';

var fs = require('fs'),
    config = require('config'),
    path = require('path'),
    express = require('express'),
    session = require('express-session'),
    google = require('googleapis'),
    Promise = require('bluebird'),
    Handlebars = require('handlebars');

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
    ),
    renderActivity = Handlebars.compile(fs.readFileSync(path.join(DOC_ROOT, 'activity.tpl.html'), {encoding: 'utf8'})),
    renderActivityList = Handlebars.compile(fs.readFileSync(path.join(DOC_ROOT, 'activity-list.tpl.html'), {encoding: 'utf8'}));

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

function Activity(user, activity) {
  this.user = user;
  this.activity = activity;
  this.comments = [];
}

Activity.prototype.getCommentCount = function () {
  return this.activity.object.replies.totalItems;
};

Activity.prototype.getActivityId = function () {
  return this.activity.id;
};

Activity.prototype.addComment = function (comment) {
  this.comments.push(comment);
};

function fetchComments(activity) {
  return new Promise(function (fulfill) {
    if (activity.getCommentCount === 0) {
      fulfill(activity);
      return;
    }

    plus.comments.list({ activityId: activity.getActivityId(), auth: oauth2Client }, function (err, comments) {
      if (!err) {
        comments.items.forEach(function (comment) {
          activity.addComment(comment);
        });
      }
      fulfill(activity);
    });
  });
}

function fetchActivities(user) {
  return new Promise(function (fulfill, reject) {
    plus.activities.list({ userId: user.id, collection: 'public', auth: oauth2Client }, function (err, activities) {
      if (err) {
        reject(new Error('activities.list() failed.'));
        return;
      }
      Promise.all(
        activities.items.map(function (activity) {
          return fetchComments(new Activity(user, activity));
        })
      ).then(function (list) {
        fulfill(list);
      });
    });
  });
}

function fetchTimeline() {
  return new Promise(function (fulfill, reject) {
    plus.people.list({ userId: 'me', collection: 'visible', auth: oauth2Client }, function (err, people) {
      if (err) {
        reject(new Error('people.list() failed.'));
      } else {
        Promise.all(
          people.items.map(function (user) {
            return fetchActivities(user);
          })
        ).then(function (list) {
          fulfill(
            list.length ? list.reduce(function (a, b) {
              return a.concat(b);
            }) : list
          );
        });
      }
    });
  });
}

function renderComments(list) {
  return list.map(function (comment) {
    return '<div><h4>Comment by ' + comment.actor.displayName + '</h4><p>' + comment.object.content + '</p></div>';
  }).join('');
}

function renderAttachments(list) {
  return list.map(function (attachment) {
    return '<div><h4>' + attachment.displayName + '</h4><p><a href="' + attachment.url + '">' + (attachment.image ? '<img src="' + attachment.image.url + '"></img>' : attachment.content) + '</a></p></div>';
  }).join('');
}

function renderTimeline(req, res, list) {
  res.send(
    renderActivityList({
      list: list.map(function (item) {
        //item.debug = JSON.stringify(item, 2);
        item.attachments = renderAttachments(item.activity.object.attachments || []);
        item.comments = renderComments(item.comments || []);
        return renderActivity(item);
      }).join('')
    })
  );
}

app.get('/', function (req, res) {
  //console.log('GET /');

  if (req.session.loggedIn) {
    // retrieve user profile
    //plus.people.get({ userId: 'me', auth: oauth2Client }, function (err, profile) {
    fetchTimeline()
    .then(
      function (list) {
        renderTimeline(req, res,
          list.sort(function (a, b) {
            return (new Date(a.activity.updated)).getTime() < (new Date(b.activity.updated)).getTime() ? -1 : 1;
          })
        );
      },
      function () {
        res.status(404);
      }
    );
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
