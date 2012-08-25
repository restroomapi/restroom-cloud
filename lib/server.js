var express = require('express');
var mongo = require('mongoskin');
var WebSocketServer = require('ws').Server;
var hash = require('node_hash');
var util = require('./util');
var RestroomSocket = require('./socket');

var db = mongo.db('localhost:27017/restroom-cloud');
var Users = db.collection('users');


function RestroomServer(options) {
  var self = this;
  
  this.options = util.extend({
    port: 80,
    socket_port: 8111
  }, options);
  
  this.sockets = {};
  
  this.server = new WebSocketServer({host: '0.0.0.0', port: this.options.socket_port});
  
  this.server.on('connection', function(socket){
    socket.on('close', function(){
      delete self.sockets[socket.key];
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
        var key = message.params[0];
        Users.findOne({key: key}, function(err, doc){
          if(!doc) {  
            socket.send('The given server key is invalid');
            socket.close();
            return;
          }
          
          if(self.sockets.hasOwnProperty(key)){
            self.sockets[key].send('Another socket established for this key');
            self.sockets[key].close();
          }
          socket.key = key;
          self.sockets[key] = new RestroomSocket(socket, self.options);
        });
      } else {
        socket.close();
      }
    });
  });
  
  this.rest = express.createServer();
  //this.rest.use(express.bodyParser());
  
  var route = function(req,res) {
    var key = req.header('host').split('.restroomapi.com')[0];
    if(!key) {
      res.send({error: "Incorrect or non-existent Restroom key given"}, 401);
      return;
    }
    if(!self.sockets.hasOwnProperty(key)) {
      Users.findOne({key: key}, function(err, doc){
        if(!doc) {
          res.send({error: "Incorrect or non-existent Restroom key given"}, 401);
          return;
        }
        res.send({error: "`"+key+"` is not connected to RestroomAPI", time: new Date()}, 503);
      });
    } else {
      self.execute(key, req.params, res);
    }
  };
  
  this.rest.get('/:destination/:method', route);
  this.rest.get('/:destination/:method/*', route);
  
  this.rest.post('/:id', function(req,res) {
    var key = req.header('host').split('.restroomapi.com')[0];
    if(!key) {
      res.send({error: "Incorrect or non-existent server_key given"}, 401);
      return;
    }
    req.pause();
    if(!self.sockets.hasOwnProperty(key)) {
      Users.findOne({key: key}, function(err, doc){
        if(!doc) {
          res.send({error: "Incorrect or non-existent Restroom key given"}, 401);
          return;
        }
        res.send({error: "`"+key+"` is not connected to RestroomAPI", time: new Date()}, 503);
      });
    } else {
      self.sockets[key].httpReceive(req.params.id, req, res);
    }
  });
  this.rest.listen(this.options.port);
}

RestroomServer.prototype.execute = function(key, params, res){
  var args = (params[0]) ? params[0].split('/') : [];
  this.sockets[key].dispatch(params.destination, params.method, args, res);
};

module.exports = RestroomServer;