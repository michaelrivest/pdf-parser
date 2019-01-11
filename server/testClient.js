let config = require('./serverConfig')

let fs = require('fs');
let path = require('path');
let zmq = require('zeromq');

module.exports = pdfParse = function (options, cb) {
    let requester = zmq.socket('req');

    requester.on('message', (data) => {
        let res = JSON.parse(data);
        if (res.success) return cb(null, res.data)
        else return cb(res.error, null);
    })

    requester.connect(`tcp://${config.host}:${config.port}`)

    let file = fs.readFileSync(options.filename)
    requester.send(JSON.stringify({ file, options }))
}

pdfParse({ filename: path.join(__dirname, 'one.pdf') }, (err, data) => {
    if (err) console.log('err');
    else console.log(data);
})

