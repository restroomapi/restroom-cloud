var util = require('./util');

function RestroomSocket(socket, options) {
  var self = this;
  
  this.options = util.extend({
    timeout: 15000
  }, options);
  
  this.requests = {};
  this.nextId = 0;
  
  this.socket = socket;
  this.socket.on('message', function(message){
    try {
      message = util.parse(message);
    } catch (e) {
      self.notify('restroom', 'warning', ['Could not parse "'+message.result+'"']);
      return;
    }
    var request = self.requests[message.id];
    if(request) {
      clearTimeout(request.timeout);
      request.res.send(message.result);
      delete self.requests[message.id];
    } else {
      self.notify('restroom', 'warning', ['Could not deliver request to ' + message.id + ', "'+message.result+'"']);
    }
  });
}

RestroomSocket.prototype.dispatch = function(destination, method, params, res){
  var self = this;
  var id = this.nextId++;
  this.socket.send(util.stringify({method: destination + '.' + method, params: params, id: id}));
  var timeout = setTimeout(function(){
    self.requests[id].res.send({error: "No response received within " + self.options.timeout + "ms"});
    delete self.requests[id];
  }, this.options.timeout);
  this.requests[id] = {res: res, timeout: timeout};
}

RestroomSocket.prototype.notify = function(destination, method, params){
  this.socket.send(util.stringify({method: destination + '.' + method, params: params}));
}

RestroomSocket.prototype.httpReceive = function(id, result){
  var request = self.requests[id];
  clearTimeout(request.timeout);
  request.res.send(result);
  delete self.requests[id];
}

RestroomSocket.prototype.close =  function(reason){
  this.notify('restroom', 'warning', ['Socket is being closed. ' + reason]);
  this.socket.close();
}

module.exports = RestroomSocket;