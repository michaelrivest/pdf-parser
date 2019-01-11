

module.exports = function(opts = {}) {
    let config = require('./serverConfig');
    config = Object.assign(config, opts);

let zmq = require('zeromq');
let path = require('path');
let fs = require('fs');

let PDFParser = require('../pdfParser');
let Parser = new PDFParser();
let options = Parser.opts;

let responder = zmq.socket('rep');

responder.on('message', (data) => {
    const req = JSON.parse(data);

    let fileName = path.join(__dirname, '../tmp', 'userFile.pdf')
    fs.writeFile(fileName, Buffer.from(req.file.data), (err) => {
        if (err) return sendRes(false, err)
        let newOptions = req.options;
        if (newOptions.boxes && newOptions.boxes.length == 0) {
            newOptions.boxes = null;
        }

        for (let opt in newOptions) {
            if (typeof options[opt] == 'number') {
                newOptions[opt] = Number(newOptions[opt]);
            }
        }
        newOptions.filename = fileName;


        console.log(newOptions);
        Parser.parse(newOptions, (err, parsed) => {
            if (err) return sendRes(false, err);
            else return sendRes(true, parsed);
        })
    })
})

function sendRes(success, data) {
    let r = { success }
    if (success) r['data'] = data;
    else r['error'] = data;
    responder.send(JSON.stringify(r))
}


responder.bind(`tcp://${config.host}:${config.port}`, (err) => {
    console.log(`Server is listening for requests on ${config.host}:${config.port}`);
})

return responder;
}

