module.exports = function (grunt) {
    grunt.initConfig({

    copy: {
	html: {
	    files: [
		{ expand: true, cwd: 'app', src: ['*.html'], dest: 'dist/'}
	    ]
	},
	config: {
	    files: [
		{ expand: true, cwd: 'app/', src: ['config.js'], dest: 'dist/'},
	    ]
	}
    },
    concat: {
	js: {
	    src: [
		"app/js/*.js"
	    ],
	    dest: 'dist/js/app.js'
	}
    },
    watch: {
	app: {
	    files: "app/**",
	    tasks: ['concat','copy']
	}
    }
});

// load plugins
grunt.loadNpmTasks('grunt-contrib-copy');
grunt.loadNpmTasks('grunt-contrib-concat');
grunt.loadNpmTasks('grunt-contrib-watch');

// register at least this one task
grunt.registerTask('default', [  'concat', 'copy' ]);

};
