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
        var type = message.params[1];
        Users.findOne({key: key}, function(err, doc){
          if(!doc) {  
            socket.send(util.stringify({method: 'server.invalidKey', params: []}));
            socket.close();
            return;
          }
          
          if(self.sockets.hasOwnProperty(key)){
            var existingSocket = self.sockets[key].socket;
            existingSocket.send(util.stringify({method: 'server.overwritten', params: []}));
            existingSocket.close();
          }
          socket.key = key;
          socket.send(util.stringify({method: 'server.open', params: []}));
          self.sockets[key] = {type: type, socket: new RestroomSocket(socket, self.options)};
        });
      } else {
        socket.close();
      }
    });
  });
  
  this.rest = express.createServer();
  //this.rest.use(express.bodyParser());
  
  var route = function(req,res) {
    var key = req.params.key;
    if(!key) {
      res.send({error: "Incorrect or non-existent Restroom key given", code: 201}, 401);
      return;
    }
    if(!self.sockets.hasOwnProperty(key)) {
      Users.findOne({key: key}, function(err, doc){
        if(!doc) {
          res.send({error: "Incorrect or non-existent Restroom key given", code: 201}, 401);
          return;
        }
        res.send({error: "`"+key+"` is not connected to RestroomAPI", time: new Date(), code: 200}, 503);
      });
    } else {
      self.execute(key, req.params, res);
    }
  };
  
  this.rest.post('/remove/:key', function(req, res){
    var key = req.params.key;
    Users.remove({key: key}, function(err, doc){
      if(!doc) {
        res.send({error: "Incorrect or non-existent Restroom key given", code: 201}, 401);
        return;
      }
      res.send({message: "`"+key+"` has been removed", time: new Date()});
    });
  });
  
  this.rest.post('/new/:key', function(req, res){
    var key = req.params.key;
    Users.findOne({key: key}, function(err, doc){
      if(!doc) {
        Users.insert({key: key}, function(err, doc){
          if(!doc) {
            res.send({error: "Unknown failure creating key"}, 500);
            return;
          }
          res.send({message: "`"+key+"` has been created", time: new Date()});
        });
        return;
      }
      res.send({error: "`"+req.params.key+"` is already taken"});
    });
  });

   this.rest.get('/:key/server/status', function(req, res){
    var key = req.params.key;
    if(!self.sockets.hasOwnProperty(key)){
      Users.findOne({key: key}, function(err, doc){
        if(!doc) {
          res.send({error: "Incorrect or non-existent Restroom key given", code: 201}, 401);
          return;
        }
        res.send({error: "Server offline", code: 200}, 503);
      });
    } else {
      res.send({message: 'Server online', type: self.sockets[key].type, code: 100});
    }
  });
  
  this.rest.get('/:key/:destination/:method', route);
  this.rest.get('/:key/:destination/:method/*', route);

 
  this.rest.post('/:key/:id', function(req,res) {
    var key = req.params.key;
    if(!key) {
      res.send({error: "Incorrect or non-existent server_key given", code: 201}, 401);
      return;
    }
    req.pause();
    if(!self.sockets.hasOwnProperty(key)) {
      Users.findOne({key: key}, function(err, doc){
        if(!doc) {
          res.send({error: "Incorrect or non-existent Restroom key given", code: 201}, 401);
          return;
        }
        res.send({error: "`"+key+"` is not connected to RestroomAPI", code: 200, time: new Date()}, 503);
      });
    } else {
      self.sockets[key].socket.httpReceive(req.params.id, req, res);
    }
  });
  this.rest.listen(this.options.port);
}

RestroomServer.prototype.execute = function(key, params, res){
  var args = (params[0]) ? params[0].split('/') : [];
  this.sockets[key].socket.dispatch(params.destination, params.method, args, res);
};

module.exports = RestroomServer;