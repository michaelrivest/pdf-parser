module.exports = function () {
    let Parser = {};
    let cp = require('child_process');
    let imageParser = require('image-parser');
    let fs = require('fs')
    let path = require('path')
    let pdf2json = require('pdf2json')

    Parser.opts = opts = {
        blCutoff: 100,
        minLineLength: 200,
        minVertLength: 30,
        skewX: 10,
        skewY: 5,

        complexDelimiter: false,
        labelOffset: 0,
        joinText: false,
        lineDelim: ' ',
        letterSpacingX: 4,
        lineSplitX: 60,
        lineSplitY: 10,
        wordJoinX: 0,

        allowPartial: false,
        boxDemarcator: 'coordinates',
        uniqBoxPointCutoff: 10,

        image: false,
        imgDensity: 60,
        id: ''
    }


    let boundChecker = (start, end) => (point) => ((point.x >= start[0] - opts.skewX) && (point.x <= end[0] - opts.skewX) && (point.y >= start[1] - opts.skewY) && (point.y <= end[1] - opts.skewY))

    Parser.fmtPdfLines = fmtPdfLines = function (lines) {
        if (opts.joinText) {
            let formatted = [];
            lines = lines.sort((a, b) => {
                let yDiff = Math.abs(a.y - b.y);
                if (yDiff > opts.lineSplitY) {
                    return a.y - b.y;
                } else {
                    return a.x - b.x;
                }
            })

            for (let line of lines) {
                if (!formatted[formatted.length - 1]) formatted.push([])
                let cur = formatted[formatted.length - 1]

                if (!cur[cur.length - 1]) {
                    cur.push(line)
                } else {
                    let li = cur[cur.length - 1]
                    let liPix = li.text.length * opts.letterSpacingX;
                    let xD = Math.abs((li.x + liPix) - line.x)
                    let yD = Math.abs(li.y - line.y)
                    if (yD < opts.lineSplitY && xD < opts.wordJoinX) {
                        cur.splice(cur.length - 1, 1, { x: li.x + xD, y: li.y, text: li.text + line.text })
                    } else if (yD < opts.lineSplitY && xD < opts.lineSplitX) cur.push(line)
                    else {
                        formatted.push([line])
                    }
                }
            }

            lines = formatted.reduce((acc, cur, i) => {
                let l = { text: cur.map(l => l.text).join(opts.lineDelim) };
                acc.push(l)
                return acc;
            }, [])
        }

        return lines.reduce((acc, cur, i) => {
            let c = cur.text;
            if (c == '-') {
                let nextPart = lines[i + 1].text;
                acc[acc.length - 1] += c + nextPart;
                lines.splice(i + 1, 1)
                return acc;
            } else {
                return acc.concat(c);
            }
        }, [])
    }

    function itemGetter(texts) {
        return function getItem(label) {
            let start = labels[label].start;
            let end = labels[label].end;
            let checkBounds = boundChecker(start, end);
            let matches = texts.filter(checkBounds).map(m => m.R[0].T)
            return matches;
        }
    }

    function boxItemGetter(texts) {
        return function getItem(box) {
            let start = box[0];
            let end = box[1];
            let checkBounds = boundChecker(start, end);
            let matches = texts.filter(checkBounds)
            return matches;
        }
    }


    Parser.txtParse = txtParse = function (filename, cb) {
        let pdfParser = new pdf2json(null, 1);
        pdfParser.on("pdfParser_dataError", (errData) => console.error(errData.parserError));
        pdfParser.on("pdfParser_dataReady", (pdfData) => {
            let text = pdfParser.getRawTextContent();
            return cb(text);
        });
         fs.readFile(filename, (err, pdfBuffer) => {
          if (!err) {
            pdfParser.parseBuffer(pdfBuffer);
          }
        })
    }

    Parser.jsonParse = jsonParse = function (filename, cb) {
        let pdfParser = new pdf2json(null, 1);
        pdfParser.on("pdfParser_dataError", (errData) => console.error(errData.parserError));
        pdfParser.on("pdfParser_dataReady", (pdfData) => {
            let pages = pdfData.formImage.Pages
            return cb(pages, pdfParser.getRawTextContent());
        });
        fs.readFile(filename, (err, pdfBuffer) => {
          if (!err) {
            pdfParser.parseBuffer(pdfBuffer);
          }
        })
    }

    Parser.imgParse = imgParse = function (doc, cb) {
        let projectId = process.env.gvision_project_id;
        let keyFilename = process.env.gvision_key_filename;
        if (!projectId || !keyFilename) return cb(Error("Google vision app credentials not set"))

        const gVision = require('@google-cloud/vision')

        const gVisionClient = new gVision.ImageAnnotatorClient({
            projectId: projectId,
            keyFilename: keyFilename 
        });

        let req = {
            image: {
                source: { filename: doc }
            }
        }
        gVisionClient.documentTextDetection(req).then((results) => {
            return cb(null, results)
        }).catch(err => cb(err))
    }

    Parser.getLines = getLines = function (filename, cb) {
        jsonParse(filename, (pages) => {
            let lines = pages.reduce((acc, cur) => {
                return acc.concat(fmtPdfLines(stdTexts(cur.Texts)))
            }, [])
            return cb(lines);
        })
    }

    function combinePages(pages) {
        return pages.reduce((acc, cur) => {
            acc.Height = cur.Height;
            acc.HLines = acc.HLines.concat(cur.HLines)
            acc.VLines = acc.VLines.concat(cur.VLines)
            acc.Fills = acc.Fills.concat(cur.Fills)
            acc.Texts = acc.Texts.concat(cur.Texts)
            acc.Fields = acc.Fields.concat(cur.Fields)
            acc.Boxsets = acc.Boxsets.concat(cur.Boxsets)
            return acc;
        }, { Height: 0, HLines: [], VLines: [], Fills: [], Texts: [], Fields: [], Boxsets: [] })
    }


    function arrToMatrix(arr, rowLength) {
        let m = [];
        for (let i = 0; i < arr.length; i += rowLength) {
            m.push(arr.slice(i, i + rowLength))
        }
        return m;
    }

    function getImageMatrix(imgPath, cb) {
        let iParser = new imageParser(imgPath);
        iParser.parse((err, img) => {
            if (err) console.log(err)
            else {
                let w = img.width();
                let pixels = img.pixels()
                cb(arrToMatrix(pixels, w))
            }
        })
    }

    function pdfToImage(filename, cb) {
        console.log("Converting " + filename)
        let imageName = `pdfImage${Parser.opts.id}.png`;
        let imagePath = path.join(__dirname, './tmp', imageName);

        let pageRange = "[0-0]"

        let convert = cp.spawn('convert', ['-density', opts.imgDensity, filename + pageRange,
            '-quality', '90', '-threshold', '70%', '-background', 'white', '-alpha', 'Background', imagePath])


        /*
        cp.exec(`convert -density ${opts.imgDensity} ${filename + pageRange} -quality 90 -threshold 70% -background white -alpha Background ${imagePath}`, (err, stdout, stderr) => {
            if (err) throw err;
            else {
                if (stderr) log("IM convert Error", stderr);
                if (stdout) log("IM convert Output", stdout);
            }
        })
        */

        convert.stdout.on('data', (d) => console.log("Out: " + d))
        convert.stderr.on('data', (d) => console.log("Err: " + d))
        convert.on('error', (err) => console.log(err))
        convert.on('close', (code, sig) => {
            console.log(code)
            return cb(imagePath)
        })
    }

    function cleanupTmpImage(imgPath) {
        if (opts.debug) return false;
        fs.unlink(imgPath, (err) => {
            if (err) console.log(err);
        })
    }

    function verticalMatch(l1, l2) {
        return (l2.start >= l1.start && l2.start <= l1.end) || (l2.end <= l1.end && l2.end >= l1.start) || (l1.start >= l2.start && l1.start <= l2.end)
    }

    const isBl = (p) => ((p.r < opts.blCutoff) && (p.g < opts.blCutoff) && (p.b < opts.blCutoff))

    Parser.debugImg = debugImg = function (filename) {
        pdfToImage(filename, (imgP) => {
            log("Image Path", imgP)
            getImageMatrix(imgP, (imgM) => {
                let total = imgM.length * imgM[0].length;
                let fin = 0;
                let bl = 0;
                for (let i = 0; i < imgM.length; i++) {
                    for (let j = 0; j < imgM[i].length; j++) {
                        fin++;
                        let cur = imgM[i][j];
                        if (isBl(cur)) {
                            bl++;
                        }
                        if (fin == total) {
                            log("Found Black Pixels", `${bl} / ${total}`)
                        }
                    }
                }
            })
        })
    }

    function parsePdfBoxes(filename, allowPartial, cb) {
        pdfToImage(filename, (imgP) => {

            getImageMatrix(imgP, (imgM) => {
                // First, Find all the Horizontal Lines
                let lines = {};
                for (let i = 0; i < imgM.length; i++) {
                    let row = imgM[i];
                    let hLines = [];
                    // log("Row Length", row.length)
                    for (let j = 0; j < row.length; j++) {
                        let cur = row[j];
                        // find a black pixel
                        if (isBl(cur)) {
                            // On finding one, begin building a horizantal line
                            let curLine = [];
                            while (cur && isBl(cur)) {
                                curLine.push(j)
                                j += 1;
                                cur = row[j];
                            }

                            // Check if H line exceeds minimum length 
                            if (curLine.length > opts.minLineLength) {
                                hLines.push({ start: curLine[0], end: j - 1 })
                            }
                        }
                    }
                    if (hLines.length > 0) lines[i] = hLines;
                }

                // Match H lines with vert lines to create boxes
                let hLines = [];
                for (let line in lines) {
                    for (let l of lines[line]) {
                        let rowInt = parseInt(line)
                        if (hLines.find(hl => hl.start == l.start && hl.end == l.end && Math.abs(hl.row - rowInt) <= 5)) {
                            // skip close lines
                        } else {
                            let hL = { row: rowInt, start: l.start, end: l.end }
                            hLines.push(hL)
                        }
                    }
                }

                let foundMatches = [];
                for (let hl of hLines) {
                    let possM = hLines.filter((pm) => ((pm.row > (hl.row + opts.minVertLength)) && (verticalMatch(hl, pm))))

                    for (let pm of possM) {
                        let verts = [];

                        let startC = Math.max(pm.start, hl.start);
                        let endC = Math.min(pm.end, hl.end);

                        for (let j = startC; j <= endC; j++) {
                            let k = hl.row;
                            let cur = imgM[k][j]

                            while (isBl(cur) && k < pm.row) {
                                k++;
                                cur = imgM[k][j]
                            }
                            if (k >= pm.row) {
                                verts.push(j)
                            }
                        }

                        if (allowPartial) {
                            // insert vertical at start/end
                            verts.unshift(startC);
                            verts.push(endC);
                        }

                        for (let i = 0; i < verts.length - 1; i++) {
                            let startV = verts[i]
                            let endV = verts[i + 1]

                            if ((endV - startV) > 5) {
                                let tl = [startV, hl.row];
                                let br = [endV, pm.row];
                                let fm = [tl, br]
                                foundMatches.push(fm)
                            }
                        }
                    }
                }

                let parsed = { H: imgM.length, W: imgM[0].length, boxes: foundMatches };

                // cleanupTmpImage(imgP)
                return cb(parsed);
            })
        })
    }

    Parser.displayPdfBoxesWithText = displayPdfBoxesWithText = function (pData, texts, cb) {
        let Canvas = require('canvas')
        let canvas = new Canvas(pData.W + 10, pData.H + 10)
        let ctx = canvas.getContext('2d');
        drawBoxes(ctx, pData.boxes, 'rgba(0,0,0,.7)');
        if (opts.boxes) drawBoxes(ctx, opts.boxes, 'rgba(150,50,50,.7)');
        drawScale(ctx, pData.H, pData.W);
        drawTexts(ctx, texts);
        let imgData = canvas.toDataURL('image/png');
        let imgString = imgData.split(',')[1];
        let testImageP = path.join(__dirname, './tmp', `testBoxImage${Parser.opts.id}.png`)
        fs.writeFile(testImageP, new Buffer(imgString, 'base64'), (err) => {
            if (err) return cb(err);
            else console.log("Saved Test image to " + testImageP)
            return cb(null, imgData)
        })
    }

    Parser.displayPdfImage = displayPdfImage = function (filename, cb) {
        jsonParse(filename, (pages) => {
            pdfToImage(filename, (imgP) => {
                getImageMatrix(imgP, (imgM) => {
                    let iH = imgM.length;
                    let iW = imgM[0].length;
                    let scale = pages[0].Height / iH;

                    console.log(pages[0].Height, iH, scale)
                    console.log("Scale: " + scale)
                    let Canvas = require('canvas');
                    let canvas = new Canvas(iW + 10, iH + 10)
                    let ctx = canvas.getContext('2d');

                    fs.readFile(imgP, function (err, iData) {
                        if (err) throw err;
                        img = new Canvas.Image;
                        img.src = iData;
                        ctx.drawImage(img, 0, 0)
                        drawScale(ctx, iH, iW);

                        let imgString = `<img src="${canvas.toDataURL()}" />`
                        let testImageP = path.join(__dirname, 'testImage.html')

                    });
                })
            })
        })

    }

    function drawScale(ctx, height, width) {
        ctx.font = '8px Arial'
        ctx.strokeStyle = 'rgba(0,0,0,.7)'
        let hMarker = Math.floor(height / 40);
        let wMarker = Math.floor(width / 20)

        for (let i = 0; i <= 40; i++) {
            let h = hMarker * i;
            let w = wMarker * i;
            //   ctx.fillText(h, width - 10, h);
            ctx.beginPath()
            ctx.lineTo(0, h);
            ctx.lineTo(5, h);
            ctx.stroke()
        }

        for (let i = 0; i <= 20; i++) {
            let h = hMarker * i;
            let w = wMarker * i;
            // ctx.fillText(w, w - 5, 5);
            for (let j = 0; j < 4; j++) {
                ctx.beginPath()
                let step = wMarker / 4 * j;
                ctx.lineTo(w + (step), 0);
                ctx.lineTo(w + (step), j == 0 ? 8 : 5);
                ctx.stroke()
            }

        }

    }

    function drawBoxes(ctx, boxes, sStyle) {
        let TLLocations = {};
        let i = 0;
        ctx.font = '8px Arial'
        ctx.strokeStyle = sStyle;
        for (let box of boxes) {
            i++;

            let TLString = box[0].join('-')
            if (typeof TLLocations[TLString] == 'number') TLLocations[TLString] += 1;
            else TLLocations[TLString] = 0;

            let offset = TLLocations[TLString] * 25;
            let x = box[0][0] + 3 + offset;
            let y = box[0][1] + 3;

            ctx.beginPath()

            let tl = box[0];
            let tr = [box[1][0], box[0][1]]
            let bl = [box[0][0], box[1][1]]
            let br = box[1];

            ctx.lineTo(...tl);
            ctx.lineTo(...tr);
            ctx.lineTo(...br);
            ctx.lineTo(...bl);
            ctx.lineTo(...tl)
            ctx.stroke();
        }
    }

    function drawTexts(ctx, texts) {
        ctx.font = '7px Arial'
        for (let t of texts) {
            let tStr = t.text;
            ctx.fillText(tStr, t.x + opts.skewX, t.y + opts.skewY);
        }
    }

    const closePoint = (p1, p2) => (Math.abs(p1[0] - p2[0]) + Math.abs(p1[1] - p2[1]) <= opts.uniqBoxPointCutoff);

    const boxMatch = (b1, b2) => (closePoint(b1[0], b2[0]) || closePoint(b1[1], b2[1]))

    function uniqByCoords(boxes) {
        let uniq = [];
        for (let box of boxes) {
            let bMatch = uniq.find(b => boxMatch(b, box))
            if (bMatch) {
                if (box[1][1] < bMatch[1][1]) {
                    let bMatchIndex = uniq.indexOf(bMatch);
                    uniq.splice(bMatchIndex, 1);
                    uniq.push(box);
                }
            } else {
                uniq.push(box);
            }
        }
        return uniq;
    }

    function boxContainsAll(checkBox, b) {
        if (b.length > checkBox.length) return false;
        else return b.every((v, i) => v == checkBox[i])
    }
    function uniqByContent(boxes) {
        let uniq = [];
        for (let box of boxes.sort((a, b) => b.content.length - a.content.length)) {
            let isUniq = true;
            for (let uBox of uniq) {
                if (boxContainsAll(uBox.content, box.content)) isUniq = false;
            }
            if (isUniq) uniq.push(box);
        }
        return uniq;
    }

    const stdTexts = (texts) => texts.map(t => Object.assign(t, { text: t.R[0] ? decodeURIComponent(t.R[0].T).trim() : "" }));

    const scaleTexts = (texts, scale) => texts.map(t => Object.assign(t, { x: (t.x / scale), y: (t.y / scale) }))


    function autoLabelBoxes(boxes) {
        return boxes.reduce((acc, cur) => {
            let curLabel = cur.content[0];
            let data = cur.content.slice(1).join(' ')
            acc[curLabel] = data;
            return acc;
        }, {})
    }

    function labelTest(label, toMatch) {
        if (typeof label == 'string') return label == toMatch;
        else return label.test(toMatch)
    }

    function getLabelledBoxes(labels, boxes) {
        let simpleLabels = labels.filter(l => typeof l == 'string').map(l => l.trim())
        let complexLabels = labels.filter(l => typeof l != 'string').map((cl) => {

            return cl.map((sublabel => {
                if (typeof sublabel != 'string') {
                    if (!sublabel.length) sublabel.length = 1;
                    if (!sublabel.as) sublabel.as = sublabel.label;
                    if (!sublabel.label) throw Error("Invalid label option: " + sublabel)
                    return sublabel;
                }
                else return { label: sublabel, length: 1, as: sublabel }
            }))
        })

        return boxes.reduce((acc, cur) => {
            if (cur.content.length == 0) return acc;
            let curLabel = cur.content[0].trim();

            if (simpleLabels.includes(curLabel)) {
                let data = cur.content.slice(1).join(' ')
                acc[curLabel] = data;
                return acc;
            } else {
                let cl = complexLabels.filter(l => labelTest(l[0].label, curLabel));
                if (cl.length > 0) {

                    let clIndex = -1;
                    let containsAll = false;
                    while (!containsAll && (clIndex + 1) < cl.length) {
                        clIndex++;
                        let clt = cl[clIndex];
                        containsAll = true;
                        let lastFound = -1;

                        for (let l of clt) {
                            let foundLabel = false;

                            for (let line of cur.content) {
                                if (labelTest(l.label, line)) {
                                    let foundIndex = cur.content.indexOf(line);
                                    if (foundIndex != (lastFound + 1)) {
                                        console.log("not matching because of label indexes: ")
                                        console.log(clt);
                                        foundLabel = false;
                                    } else foundLabel = true;

                                    lastFound = foundIndex;
                                }
                            }
                            if (!foundLabel) containsAll = false;
                        }
                    }

                    if (clIndex == cl.length) {
                        console.log("none found containing all")
                    }

                    let labs = {};
                    let lContiguous = [];

                    for (let k = 0; k < cur.content.length; k++) {
                        let line = cur.content[k];
                        let matchLabel = cl[clIndex].find(l => labelTest(l.label, line));

                        if (matchLabel) {
                            lContiguous.push(matchLabel);
                        } else {
                            for (let match of lContiguous) {
                                labs[match.as] = cur.content.slice(k, k + match.length).join('\n');
                                k += match.length;
                            }
                            lContiguous = [];
                        }
                    }
                    return Object.assign(acc, labs)
                } else {
                    log("No Match", cur)
                    return acc;
                }
            }
        }, {})
    }

    function applyUserOptions(options) {
        Object.assign(opts, options);
    }

    Parser.createDelimiter = createDelimiter = function (lines, delim) {
        return function (delimiter) {
            let possDelims = delim[delimiter];
            for (let l of lines) {
                for (let d of possDelims) {
                    if (l.indexOf(d) >= 0) return l.replace(d, '').trim();
                }
            }
        }
    }

    function prepLabel(label) {
        if (!label.endAdj && label.endAdj !== 0) label.endAdj = 1;
        if (!label.labelLength) label.labelLength = 1;
        if (!label.fieldLength) label.fieldLength = 1;
        if (!label.startAdj) label.startAdj = 0;
    }
    function labelMatch(label, lines) {
        if (label.labelLength > 1) {
            for (let l = 0; l < lines.length; l++) {
                if (label.startRegEx[0].test(lines[l])) {
                    let relLines = lines.slice(l, l + label.startRegEx.length);
                    if (relLines.every((line, i) => label.startRegEx[i].test(line))) {
                        return l;
                    }
                }
            }
            return -1;
        } else {
            try {
                let line = lines.find((l) => label.startRegEx.test(l))
                return lines.indexOf(line);
            } catch (err) {
                console.log("Invalid Label: ")
                console.log(label)
                return -1;
            }
        }
    }

    function getLabelData(label, lines, fields) {
        prepLabel(label);
        let lineIndex = labelMatch(label, lines);
        if (lineIndex >= 0) {
            let lineMatch = lines.slice(lineIndex, lineIndex + label.labelLength).join(' ')
            if (label.labelLength > 1) {
                lines.splice(lineIndex, label.labelLength, lineMatch)
            }

            let endIndex;
            if (label.endRegEx) {
                let endLine = lines.slice(lineIndex).find((l) => {
                    return label.endRegEx.test(l)
                })
                if (endLine) {
                    endIndex = lines.indexOf(endLine) + label.endAdj - 1;
                }
            } else if (label.fieldLength) {
                if (lineIndex + label.fieldLength > lines.length) {
                    label.fieldLength = lines.length - lineIndex;
                }
                endIndex = lineIndex + label.fieldLength;
            } else endIndex = lineIndex + label.endAdj;

            let fieldMatch = lines.slice(lineIndex + opts.labelOffset, endIndex + opts.labelOffset);

            if ((lineIndex + label.startAdj) < 0) label.startAdj = (0 - lineIndex);
            if (label.getIndex || typeof label.getIndex == 'number') {
                fieldMatch = fieldMatch[label.getIndex]
            } else {
                fieldMatch = lines.slice(lineIndex + label.startAdj + opts.labelOffset, endIndex + opts.labelOffset);
            }

            if (label.mapFn) {
                try {
                    fieldMatch = label.mapFn(fieldMatch, lineMatch.match(label.startRegEx));
                } catch (err) {
                    console.log(`Error mapping field ${label.name}:`)
                    console.log(err);
                }
            }
            fields[label.name] = fieldMatch;
        }
    }

    function getCDelimBoxes(labels, boxes) {
        let fields = {};
        fields.multiple = {};
        for (let b of boxes) {
            let pRes = complexDelimiter(b.content, labels);
            for (let label in pRes) {
                if (!fields[label]) {
                    fields[label] = pRes[label];
                } else {
                    let fieldEquivalent;
                    if (typeof pRes[label] == 'string' || typeof fields[label] == 'string') {
                        fieldEquivalent = pRes[label] == fields[label];
                    } else {
                        fieldEquivalent = fields[label].every((v, i) => v == pRes[label][i]);
                    }
                    if (!fieldEquivalent) {
                        if (fields.multiple[label]) fields.multiple[label].push(pRes[label])
                        else fields.multiple[label] = [pRes[label]]
                    }
                }
            }
        }
        return fields;
    }

    Parser.complexDelimiter = complexDelimiter = function (lines, labels, options = {}) {
        applyUserOptions(options)
        let fields = {};

        for (let label of labels) {
            if (label.multi) {
                let lResults = {};
                for (let sub of label.labels) {
                    prepLabel(sub);
                    lResults[sub.name] = Object.assign({}, sub);
                    let lMatch = labelMatch(sub, lines);
                    if (lMatch >= 0) {
                        let lStart = lMatch;
                        let lFull = lines.slice(lStart, lStart + sub.labelLength);
                        lines.splice(lStart, sub.labelLength, lFull.join(' '));
                        lResults[sub.name].startIndex = lStart;
                        lResults[sub.name].labelFull = lFull.join(' ');
                    }
                }

                let resIndex = Object.keys(lResults).length;

                for (let l in lResults) {
                    if (typeof lResults[l].startIndex == 'number') {
                        let endIndex;
                        if (lResults[l].fieldLength) {
                            endIndex = resIndex + lResults[l].fieldLength;
                        } else endIndex = resIndex + lResults[l].endAdj;


                        if ((resIndex + lResults[l].startAdj) < 0) lResults[l].startAdj = (0 - lResults[l].startAdj);

                        let fieldMatch = lines.slice(resIndex, endIndex);

                        fieldMatch.unshift(lResults[l].labelFull);

                        if (lResults[l].getIndex || typeof lResults[l].getIndex == 'number') {
                            fieldMatch = fieldMatch[lResults[l].getIndex + opts.labelOffset]
                        } else {
                            fieldMatch = fieldMatch.slice(lResults[l].startAdj + opts.labelOffset)
                        }

                        if (lResults[l].mapFn) {
                            try {
                                fieldMatch = lResults[l].mapFn(fieldMatch, lineMatch.match(lResults[l].startRegEx));
                            } catch (err) {
                                console.log(`Error mapping field ${l}:`)
                                console.log(err);
                            }
                        }
                        lResults[l].match = fieldMatch;
                        resIndex = endIndex;
                    }
                }
                if (Object.values(lResults).filter(l => l.match).length >= label.minMatch) {
                    for (let l in lResults) {
                        if (lResults[l].match) fields[l] = lResults[l].match;
                    }
                }
            } else {
                getLabelData(label, lines, fields)
            }
        }
        return fields;
    }

    function findMedian(matches) {
        if (matches.length == 1) return { x: matches[0].x, y: matches[0].y }
        let Xs = matches.sort((a, b) => { return a.x - b.x })
        let Ys = matches.sort((a, b) => { return a.y - b.y })

        let mid = matches.length % 2 == 0 ? (matches.length / 2) : ((matches.length - 1) / 2)
        return { x: Xs[mid].x, y: Ys[mid].y };
    }

    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
    }

    function peiceTogetherMatches(line, curLineIndex = 0, progress = []) {
        let sBuf = curLineIndex;
        while (line.text[sBuf] == ' ') { sBuf++; }

        if (sBuf == line.text.length) {
            return progress;
        }

        let relTexts = line.possibleMatches.filter(t => t.index == sBuf)

        for (let t of relTexts) {
            let p = [...progress, t]
            let newI = sBuf + t[0].length

            let matched = peiceTogetherMatches(line, newI, p);
            if (matched) return matched;
        }
        return false;
    }

    function joinTexts(textArr, rawText) {
        let nText = [];
        let progress = rawText.split("\n").map(tLine => {
            return { text: tLine.replace("\r", ""), currentIndex: 0, matchedIndices: [], possibleMatches: [] }
        })

        for (let t of textArr) {
            let regText = escapeRegExp(t.text)
            let curReg = new RegExp("(\s*" + regText + "\s*)", "g")

            for (let line of progress) {
                while ((match = curReg.exec(line.text)) != null) {
                    let m = { x: t.x, y: t.y, text: t.text, tIndex: textArr.indexOf(t) }
                    let lastLargest = line.possibleMatches.find(l => l.index == match.index);
                    if (lastLargest) {
                        if (lastLargest.text.length < m.text.length) {
                            let lastLIndex = line.possibleMatches.indexOf(lastLargest);
                            line.possibleMatches.splice(lastLIndex, 1, Object.assign(match, m))
                        }
                    } else {
                        line.possibleMatches.push(Object.assign(match, m));
                    }
                }
                line.possibleMatches = line.possibleMatches.sort((a, b) => {
                    if (Math.abs(a.y - b.y) < 5) return (a.x - b.x)
                    else return (a.y - b.y);
                })
            }
        }
        let foundMatchIndices = [];
        for (let line of progress) {
            let match = peiceTogetherMatches(line);
            if (match && match.length > 0) {
                let foundIndices = match.map(m => m.tIndex);
                foundMatchIndices = foundMatchIndices.concat(foundIndices)
                processMatch(match, nText)
            }
        }
        for (let t = 0; t < textArr.length; t++) {
            if (!foundMatchIndices.includes(t)) nText.push(textArr[t])
        }
        return nText;
    }

    function processMatch(match, mArray) {
        let pos = findMedian(match);
        let nItem = { x: pos.x, y: pos.y, text: match[0].input }
        mArray.push(nItem)
    }

    function time(label) {
        if (!opts.debug) return;
        if (!time.timers) time.timers = {};
        if (!time.timers[label]) time.timers[label] = 0;

        if (time.timers[label] % 2 == 0) console.time(label)
        else console.timeEnd(label)

        time.timers[label] += 1;
    }

    function logTexts(texts) {
        texts.forEach((t) => {
            console.log("x: " + t.x.toFixed(2), "y: " + t.y.toFixed(2))
            console.log(t.R[0] ? decodeURIComponent(t.R[0].T).trim() : "NULL")
        })
    }
    function log(label, data) {
        if (!opts.debug) return;
        console.log("\n" + label + ": ")
        if (label == "Texts") {
            // logTexts(data);
        } else if (label == "Box Content") {
            data.forEach(b => {
                // console.log(b.box[0].join(':') + "-" + b.box[1].join(':'), b.content.join(' '))
                // console.log(b.content)
            })
        } else {
            console.log(data)
        }
    }



    Parser.parse = parse = function (options, cb) {
        applyUserOptions(options);
        time("parse")
        log("Options", opts)

        let output = {}
        let filename = options.filename;

        // if (opts.debug) debugImg(filename);

        time("jsonParse")
        jsonParse(filename, (pages, pdfText) => {
            log("PDF Text", pdfText.slice(0, 500))
            time("jsonParse")
            time("parsePdfBoxes")
            parsePdfBoxes(filename, opts.allowPartial, (parsed) => {
                time("parsePdfBoxes")

                let boxes;
                if (opts.boxes) {
                    boxes = opts.boxes;
                } else if (opts.boxDemarcator == 'coordinates') {
                    boxes = uniqByCoords(parsed.boxes);
                } else {
                    boxes = parsed.boxes;
                }
                parsed.boxes = boxes;

                log("Box Coordinates", boxes)

                let page = pages[0]
                let scale = page.Height / parsed.H;
                let texts = stdTexts(scaleTexts(page.Texts, scale))

                log("Texts", texts);

                let getItem = boxItemGetter(texts)
                let boxContent = boxes.map((box) => { return { box: box, content: fmtPdfLines(getItem(box)) } });

                if (opts.boxDemarcator == 'content') {
                    boxContent = uniqByContent(boxContent);
                }

                log("Box Content", boxContent)

                if (options.text) {
                    output.text = pdfText;
                }
                if (options.raw) {
                    output.raw = boxContent;
                }

                let parseResult;
                if (options.labels) {
                    if (options.complexDelimiter) {
                        parseResult = getCDelimBoxes(options.labels, boxContent)
                    } else {
                        parseResult = getLabelledBoxes(options.labels, boxContent)
                    }

                } else {
                    parseResult = autoLabelBoxes(boxContent)
                }

                log("Final Result", parseResult)
                time("parse")
                output.fields = parseResult;

                if (opts.image) {
                    displayPdfBoxesWithText(parsed, texts, (err, imgData) => {
                        if (err) console.log(err);
                        output.image = imgData;
                        return cb(null, output)
                    })
                } else {
                    return cb(null, output)
                }

            })
        })
    }

    return Parser;
}

