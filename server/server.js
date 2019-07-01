let config = require('./serverConfig');

function randomString(length, radix = 36) {
    let rString = '';
    while (rString.length < length) {
        let neededLength = length - rString.length;
        let rStringSection = Math.random().toString(radix).slice(2);
        if (rStringSection.length > neededLength) rString += rStringSection.slice(0, neededLength);
        else rString += rStringSection;
    }
    return rString;
}

module.exports.interactive = interactive = function (options = { image: true } ) {
    let path = require('path');
    let fs = require('fs');
    let tmpFolder = path.join(__dirname, '../tmp');
    let cors = require('cors');
    let express = require('express');
    let bodyParser = require('body-parser');
    let app = express();
    let port = 4775;

    if (!fs.existsSync(tmpFolder)) {
        fs.mkdirSync(tmpFolder, {recursive: true})
    }

    let corsOptions = {
        credentials: true,
        origin: function (origin, cb) {
            cb(null, true);
        }
    }
    app.use(cors(corsOptions));

    let PDFParser = require('../pdfParser');

    app.listen(port, "0.0.0.0", () => { console.log("Parser listening on port " + port) });

    app.use(express.static(path.join(__dirname, '../tmp')));

    app.set('view engine', 'ejs');

    let viewDir = path.join(__dirname, 'views');
     app.set('views', viewDir)
    app.use(bodyParser.json({ 'limit': "50mb" }));

    const session = require('express-session');
    app.use(session({
        secret: "francisMH",
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            maxAge: 86400000,
        }
    }));


    app.use((req, res, next) => {
        console.log("Session: " + req.session._id)
        console.log(req.url);
        if (!req.session._id) {
            req.session._id = randomString(14)
        }
        next();
    })


    app.get('/', (req, res) => {
        res.render('index', { id: req.session._id, serverAddress: config.host + ":" + config.port })
    })


    app.post('/parse/:id', (req, res) => {
        let newOptions = req.body;
        if (newOptions.boxes && newOptions.boxes.length == 0) {
            newOptions.boxes = null;
        }

        for (let opt in newOptions) {
            if (typeof options[opt] == 'number') {
                newOptions[opt] = Number(newOptions[opt]);
            }
        }


        let Parser = new PDFParser(); 
        newOptions.filename = path.join(__dirname, '../tmp', req.params.id + '.pdf' )
        newOptions.image = true;
        newOptions.id = req.params.id;

        Parser.parse(newOptions, (err, parsed) => {
            if (err) throw err;
            return res.json({ success: true, parsed });
        })

    })

    app.post('/upload/:id', (req, res) => {
        let userFile = req.body.fileContent.slice(28)
        let fileName = path.join(tmpFolder, req.params.id + '.pdf')

        

        fs.writeFile(fileName, Buffer.from(userFile, 'base64'), (err) => {
            if (err) throw err;

            let Parser = new PDFParser();
            Parser.opts.filename = fileName;
            Parser.opts.image = true;
            Parser.opts.boxes = null;

            Parser.opts.id = req.params.id;
            Parser.parse(Parser.opts, (err, parsed) => {
                if (err) throw err;
                return res.json({ success: true, parsed });
            })

        })
    })
}
