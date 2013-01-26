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
    RangeList();
    // why doesn't this get inherited???
    this.ranges = [];
    this.attach(session);
    self = this;
    session.on("tokenizerUpdate", function(e) {
        self.publish();
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

    this.publish = function () {
        var list = this.ranges;
        // first clear
        var alldivs = document.getElementsByClassName("clipbd");

        for (var d = 0; d < alldivs.length; d++) {
            alldivs[d].innerHTML = "";
        }

        for (var j = 0; j < list.length; j++) {
            phrase = list[j];
            var classname = "ace_nt_" +  phrase.code;
            var cdivs = document.getElementsByClassName(classname);
            for (var i = 0 ; i < cdivs.length ; i++ )
            {
                self = this;
                if (cdivs[i].nodeName != 'DIV')
                    continue;
                var p = dom.createElement("p");
                p.textContent = phrase.phrase;
                p.onclick = function (phrase) {
                    return function () {
                        editor.revealRange(phrase, true);
                    }
                }(phrase);
                cdivs[i].appendChild(p);
            }
        }
    }
    
}).call(PhraseList.prototype);
 
});
