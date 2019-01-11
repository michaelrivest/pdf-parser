let path = require('path')
let cp = require('child_process');
let PDFParser = require('./pdfParser')
let pdfParse = new PDFParser()
let parseDocImg = pdfParse.imgParse;

function fileExt(filename) {
    let ext = path.extname(filename)
    if (!ext || ext.length == 1) return ext;
    else {
        return ext.slice(1).toLowerCase()
    }
}

class IDValue {
    constructor(possibleVals = [], inputTests = [], parsedInputTests = []) {
        this.inputType = parsedInputTests ? 'file' : 'text'
        this.inputTests = inputTests;
        this.parsedInputTests = parsedInputTests;

        this.values = possibleVals.reduce((acc, cur) => {
            acc[cur] = 0;
            return acc;
        }, {})
        this.parseErrors = [];
    }

    get error() { return (this.parseErrors.length > 0) }

    get imageExtensions() { return ['png', 'jpg', 'jpeg', 'tif'] }
    get gcCompatibleImageExtensions() { return ['png', 'jpeg', 'jpg'] }

    get match() {
        let max = Object.keys(this.values).reduce((acc, cur) => {
            if (!this.values[acc] || this.values[cur] > this.values[acc]) return cur;
            else return acc;
        })
        return this.values[max] ? max : null;
    }

    increment(doc, val) {
        this.values[doc] += val;
    }

    addValues(tests, lines) {
        for (let line of lines) {
            for (let t of tests) {
                let result = t.regex.exec(line);
                if (result) {
                    if (typeof t.value == 'number') this.increment(t.document, t.value)
                    else this.increment(t.document, t.value(result))
                }
            }
        }
    }


    handlePErr(filename, error) {
        this.parseErrors.push({ file: filename, error: error })
        return null;
    }


    convertImage(filename, cb) {
        let currentImageExt = path.extname(filename);
        let imgName = filename.replace(currentImageExt, '.png')
        cp.exec(`convert ${filename} ${imgName}`, (err, stdout, stderr) => {
            return cb(err, imgName);
        })
    }



    parseImage(filename, cb) {
        parseDocImg(filename, (err, result) => {
            if (err) return cb(this.handlePErr(filename, err));
            let fullText = result[0].fullTextAnnotation.text;
            let lines = fullText.split('\n');
            cb(lines)
        })
    }

    parsePDF(filename, cb) {
        pdfParse.txtParse(filename, (txt) => { cb(txt.split('\n')) })
    }

    parse(filename, cb) {
        let fExt = fileExt(filename);

        if (fExt == 'pdf') this.parsePDF(filename, cb)

        else if (this.imageExtensions.includes(fExt)) {
            if (this.gcCompatibleImageExtensions.includes(fExt)) {
                this.parseImage(filename, cb)
            } else {
                this.convertImage(filename, (err, convertedImagePath) => {
                    if (err) return cb(this.handlePErr(filename, err));
                    this.parseImage(convertedImagePath, cb)
                })
            }
        } else {
            return cb(this.handlePErr(filename, Error("Couldnt parse file with extension " + fExt)))
        }
    }


    identifyFile(filename, cb) {
        let filenameTests = this.inputTests;
        this.addValues(filenameTests, [filename])
        if (this.inputType == 'file') {
            let bodyTests = this.parsedInputTests;
            this.parse(filename, (txt) => {
                this.addValues(bodyTests, txt)
                return cb(this)
            })

        } else {
            return cb(this)
        }
    }


}
module.exports = IDValue;
