'use strict';
var fs = require('fs'),
    path = require('path'),
    should = require('should'),
    sass = require('node-sass'),
    request = require('supertest'),
    connect = require('connect'),
    middleware = require('../middleware'),
    cssfile = path.join(__dirname, '/test.css'),
    scssfile = path.join(__dirname, '/test.scss'),
    cssIndexFile = path.join(__dirname, '/index.css'),
    scssDependentFile = path.join(__dirname, '/test.scss');

describe('Creating middleware', function () {

  it('throws an error when omitting src', function () {
    middleware.should.throw(/requires "src"/);
  });

  it('returns function when invoked with src option', function () {
    middleware({ src: __dirname }).should.be.type('function');
  });

  it('can be given a string as the src option', function () {
    middleware(__dirname).should.be.type('function');
  });

});

describe('Using middleware', function () {
  var server = connect()
    .use(middleware({
      src: __dirname,
      dest: __dirname
    }));

  beforeEach(function (done) {
    fs.exists(cssfile, function (exists) {
      if (exists) {
        fs.unlink(cssfile, done);
      } else {
        done();
      }
    });
  });

  describe('successful file request', function () {

    it('serves a file with 200 Content-Type css', function (done) {
      request(server)
        .get('/test.css')
        .set('Accept', 'text/css')
        .expect('Content-Type', /css/)
        .expect(200, done);
    });

    it('serves the compiled contents of the relative scss file', function (done) {
      var filesrc = fs.readFileSync(scssfile),
          result = sass.renderSync({ data: filesrc.toString() });
      request(server)
        .get('/test.css')
        .expect(result.css.toString("utf8"))
        .expect(200, done);
    });

    it('writes the file contents out to the expected file', function (done) {
      var filesrc = fs.readFileSync(scssfile),
          result = sass.renderSync({ data: filesrc.toString() });
      request(server)
        .get('/test.css')
        .expect(result.css.toString("utf8"))
        .expect(200, function (err) {
          if (err) {
            done(err);
          } else {
            (function checkFile() {
              if (fs.existsSync(cssfile)) {
                fs.readFileSync(cssfile).toString().should.equal(result.css.toString("utf8"));
                done();
              } else {
                setTimeout(checkFile, 25);
              }
            }());
          }
        });
    });

  });

  describe('unsucessful file request', function () {

    it('moves to next middleware', function (done) {
      request(server)
        .get('/does-not-exist.css')
        .expect('Cannot GET /does-not-exist.css\n')
        .expect(404, done);
    });

  });

  describe('compiling files with dependences (source file contains includes)', function() {

    it('any change in a dependent file, force recompiling', function(done) {

      request(server)
        .get('/index.css')
        .expect(200, function() {
          fs.stat(cssIndexFile, function(err, initialDate) {
            // modify dependent file
            fs.appendFile(scssDependentFile, '\n', function(err, data) {
              if (err) throw err;
              request(server)
                .get('/index.css')
                .expect(200, function() {
                    fs.stat(cssIndexFile, function(err, endDate) {
                      if (endDate.mtime > initialDate.mtime) done();
                    });
                });
            });
          });

        });
    });
  });

});
