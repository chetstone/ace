/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 * 
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */

define(function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var dom = require("../lib/dom");
var TextMode = require("./text").Mode;
var JavaScriptMode = require("./javascript").Mode;
var XmlMode = require("./xml").Mode;
var HtmlMode = require("./html").Mode;
var Tokenizer = require("../tokenizer").Tokenizer;
var NotetakerHighlightRules = require("./notetaker_highlight_rules").NotetakerHighlightRules;
var NotetakerFoldMode = require("./folding/notetaker").FoldMode;
var RangeList = require("../range_list").RangeList;
var Range = require("../range").Range;
var BackgroundTokenizer = require("../background_tokenizer").BackgroundTokenizer;
var CstyleBehaviour = require("./behaviour/cstyle").CstyleBehaviour;
var TokenIterator = require("../token_iterator").TokenIterator;


var Mode = function() {
    var highlighter = new NotetakerHighlightRules();
    
    this.$tokenizer = new Tokenizer(highlighter.getRules());
    this.$embeds = highlighter.getEmbeds();
    this.createModeDelegates({
      "js-": JavaScriptMode,
      "xml-": XmlMode,
      "html-": HtmlMode
    });
    
    this.foldingRules = new NotetakerFoldMode();
};
oop.inherits(Mode, TextMode);

(function() {
    this.getNextLineIndent = function(state, line, tab) {
        if (state == "listblock") {
            var match = /^(\s*)(?:([-+*])|(\d+)\.)(\s+)/.exec(line);
            if (!match)
                return "";
            var marker = match[2];
            if (!marker)
                marker = parseInt(match[3], 10) + 1 + ".";
            return match[1] + marker + match[4];
        } else {
            return this.$getIndent(line);
        }
    };

    this.isSaneInsertion = function (editor, session) {
        return false; // for now, don't ever insert [] for [
        var cursor = editor.getCursorPosition();
        var line = session.doc.getLine(cursor.row);
        var rightChar = line.substring(cursor.column, cursor.column + 1);
        return !rightChar || /[^\w]/.test(rightChar);
    };

    this.$previousWord = function (line,len) {
        var stline = line.substring(0,len);
        // be tolerant of punctuation between words to
        // accomodate sloppy typists.
        return stline.match(/\b[\w\,\.\:\;\?\!\+\*\#]+$/);
    };

    this.$moveOpeningLeft = function (selection, start, cursor, line, existing) {
        var rsub = line.substring(start.column+existing,cursor.column);
        var match = this.$previousWord(line, start.column -existing);
        if (match) {
            var llength = start.column  - match.index;
            var offset = llength + rsub.length + 1
            selection.setSelectionRange(
                new Range(cursor.row, match.index,
                          cursor.row, start.column + existing));
            return {text: '[' + line.substring(match.index,start.column),
                    selection: [offset, offset]};
        } else {
            // no previous word?
            return false;
        }
    };

    this.transformAction = function(state, action, editor, session, text) {
        if (action === 'insertion' ) {
            var cursor = editor.getCursorPosition();
            var line = session.doc.getLine(cursor.row);
            var rightChar = line.substring(cursor.column, cursor.column + 1);

            if (/[ \n,?!.]/.test(text) && session.ntAbbrevs && rightChar != ']')
            {  // possibly insert abbrev
                if (!editor.selection.isEmpty()) {
                    return false;
                }
                var match = this.$previousWord(line,cursor.column);
                if (match) {
                    var subs;
                    if (subs = session.ntAbbrevs[match[0]]) {
                        session.selection.setSelectionRange(
                            new Range(cursor.row, cursor.column -
                                      match[0].length,
                                      cursor.row, cursor.column));
                        return {text: subs + text};
                    }
                }
            } else if (text === '[') {
                var selection = editor.getSelectionRange();
                var selected = session.doc.getTextRange(selection);
                if (selected !== "" && editor.getWrapBehavioursEnabled()) {
                    CstyleBehaviour.recordAutoInsert(editor, session, "]");
                    var t = '[' + selected + '][]';
                    return {
                        text: t,
                        selection: [t.length-1,t.length-1]
                    };
                } else if (this.isSaneInsertion(editor, session)) {
                    CstyleBehaviour.recordAutoInsert(editor, session, "]");
                    // need matching deletion that uses this.
                        return {
                            text: '[]',
                            selection: [1, 1]
                        };
                }
            } else if (text == ']' || text == ' ') {

                var iterator = new TokenIterator(session, cursor.row, cursor.column);
                var complete = CstyleBehaviour.$matchTokenType(iterator.getCurrentToken(),["constant"]);

                var lBrackets = line.substring(cursor.column - 2, cursor.column);

                if (rightChar == ']' && complete) {
                    var matching = session.$findOpeningBracket(']', {column: cursor.column + 1, row: cursor.row},/text/);

                    if (matching !== null && CstyleBehaviour.isAutoInsertedClosing(cursor, line, ']')) {
                        CstyleBehaviour.popAutoInsertedClosing();
                        return {
                            text: '',
                            selection: [1, 1]
                        };
                    }
                } else if (lBrackets == '][' && text == ']') {
                    //  ... text][
                    // electric select previous word
                    // see if a left bracket is already present
                    var matching = session.$findOpeningBracket(']',
                                {column: cursor.column - 1, row: cursor.row},
                                                               /text/);
                    if (matching !== null && matching.row == cursor.row ) {
                        // there is a left bracket, move it backwards one word.
                        return this.$moveOpeningLeft(session.selection,
                                                     matching, cursor, line, 1);
                    } else {
                        // '][' and no opening bracket on this line
                        return this.$moveOpeningLeft(session.selection,
                                                     {row:cursor.row, column:
                                                      cursor.column-2},
                                                     cursor, line, 0);
                    }
                } else if (text == ']')
                {
                    // ']' with no previous context. Initiate electric brackets.
                    var result;
                    var matching = session.$findOpeningBracket(']',
                              {column: cursor.column, row: cursor.row}, /text/);
                    if (matching == null || matching.row !== cursor.row ) {
                        //  and no opening bracket on this line
                        result = this.$moveOpeningLeft(session.selection,
                                                       cursor, cursor, line, 0);
                        if (!result) {
                            return result;
                        }
                        result.text += '][]'
                        result.selection[0] +=2;
                        result.selection[1] +=2;
                    } else {
                        // or if there is a left bracket, use it.
                        result = { text: '][]', selection: [2,2] };
                    }
                    CstyleBehaviour.recordAutoInsert(editor, session, "]");
                    return result;
                }
            }
        }
        return false;
    };


    this.createWorker = function(session) {

        noteBgTok = new NoteBackgroundTokenizer(this.$tokenizer, session);

        oop.mixin(session.bgTokenizer, noteBgTok);

    };
    
}).call(Mode.prototype);

exports.Mode = Mode;

var NoteBackgroundTokenizer = function(tokenizer, session) {
    this.phraselist = new PhraseList(session);

};


(function () {

    this.$updateOnChange = function(delta) {
        this.phraselist.invalidateLines(delta);
        BackgroundTokenizer.prototype.$updateOnChange.call(this,delta);
    };
    
    this.$tokenizeRow = function(row) {
        var tokens = BackgroundTokenizer.prototype.$tokenizeRow.call(this,row);
        var cstart = 0;
        var cend = 0;
        var range = null;
        for (var i = 0; i < tokens.length; i++) {
            if (tokens[i].type.indexOf("nt_") == 0) {
                // this is a token of interest
                if ( tokens.length -i < 4) {
                    throw new Error("phrase token set not long enough");
                }
                cend = cstart;
                for( var j = i; j < i + 3; j++) {
                    cend += tokens[j].value.length;
                }
                // range includes brackets
                range = new Range(row, cstart - 1, row, cend);
                range.phrase = tokens[i].value;
                range.code   = tokens[i +2].value;

                this.phraselist.addPhrase(range);
            }
            cstart += tokens[i].value.length;
        }
            
        return tokens;
    }
    
}).call(NoteBackgroundTokenizer.prototype);

// Constructor
var PhraseList = function (session) {
    RangeList.call(this);
    this.attach(session);
    self = this;
    session.on("tokenizerUpdate", function(e) {
        session.publishPhrases.call(self);
//        console.log("Tokenizer update lines" + e.data.first + ", " + e.data.last);
        });
};

oop.inherits(PhraseList,RangeList);

(function () {
    this.invalidateLines = function (delta) {
        var range = delta.range;
        var startRow = range.start.row
        var endRow = range.end.row;

        var list = this.ranges;
        if (!list[0] || list[0].start.row > endRow || list[list.length - 1].start.row < startRow) {
//            console.log("Nothing to remove");
            return;
        }

        var startIndex = this.pointIndex({row: startRow, column: 0});
        if (startIndex < 0)
            startIndex = -startIndex - 1;
        var endIndex = this.pointIndex({row: endRow, column: 0}, startIndex);
        if (endIndex < 0)
            endIndex = -endIndex - 1;

        if (delta.action[0] == "r") {
            endRow +=1;
        }

        var removed = this.ranges.splice(startIndex,endRow-startRow );
//        console.log("Removed: " +removed);
//        console.log("After removal: " + this.ranges);
    }
    
    this.addPhrase = function (phrase) {
        this.add(phrase);
//        console.log( this.ranges);
    }
    
    this.$onChange = function(e) {
        RangeList.prototype.$onChange.call(this,e);
//        console.log("Action: " + e.data.action + " Range: " + e.data.range);
//        console.log( this.ranges);
        
    }
    
}).call(PhraseList.prototype);
 
});
