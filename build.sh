#!/bin/sh
( cd lib/ace/mode/_test; node highlight_rules_test.js notetaker) && \
node ./Makefile.dryice.js && \
if [  "$1" = '-a' ]
then
# echo "DONE: Copying to railshost" && scp -pr ./build/src railshost:ace/build
 echo "DONE: Copying to joyent" && scp -pr ./build/src joyent:/var/www/ace/build
 echo "BUILDING on joyent" && ssh joyent bin/reupp
fi    


