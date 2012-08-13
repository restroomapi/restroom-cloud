var express = require('express');
var mongo = require('mongoskin');
var WebSocketServer = require('ws').Server;
var hash = require('node_hash');
var util = require('./util');
var RestroomSocket = require('./socket');

var db = mongo.db('localhost:27017/restroom');
var Users = db.collection('users');


function RestroomServer(options) {
  var self = this;
  
  this.options = util.extend({}, options);
  
  this.sockets = {};
  this.keys = {};
  
  this.server = new WebSocketServer({host: '0.0.0.0', port: 8080});
  
  this.server.on('connection', function(socket){
    socket.on('close', function(){
      delete self.sockets[socket.restroomURL];
    });
    socket.on('message', function(message){
      socket.removeAllListeners('message');
      try {
        message = util.parse(message);
      } catch (e){
        socket.close();
        return;
      }
      if(message.method == 'authenticate') {
        Users.findOne({server_key: message.params[0]}, {url: 1}, function(err, doc){
          if(!doc) {      
            socket.close();
            return;
          }
          var url = doc.url
          if(self.sockets[url]){
            self.sockets[url].close('Another socket established for this account');
          }
          socket.restroomURL = url;
          self.sockets[url] = new RestroomSocket(socket, self.options);
        });
      } else {
        socket.close();
      }
    });
  });
  
  this.rest = express.createServer();
  this.rest.use(express.bodyParser());
  
  this.rest.get('/:destination/:method/*', function(req,res) {
    var user = req.header('host').split('.restroomapi.com')[0];
    var key = req.header('x-restroom-key') || req.query.restroom_key;
    if(!key || !user) {
      res.send({error: "Incorrect or non-existent restroom_key given"}, 401);
      return;
    }
    if(self.keys[key] !== user) {
      Users.findOne({url: user, keys: {$elemMatch: {key: key}}}, {url: 1}, function(err, doc){
        if(!doc) {
          res.send({error: "Incorrect or non-existent restroom_key given"}, 401);
          return;
        }
        self.execute(user, req.params, res);
      });
    } else {
      self.execute(user, req.params, res);
    }
  });
  this.rest.listen(80);
}

RestroomServer.prototype.execute = function(url, params, res){
  var args = params[0].split('/');
  if(this.sockets[url]) {
    this.sockets[url].dispatch(params.destination, params.method, args, res);
  } else {
    res.send({error: "`"+url+"` is not connected to RestroomAPI", time: new Date()}, 503);
  }
};
module.exports = RestroomServer;