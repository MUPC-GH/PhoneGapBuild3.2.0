/**
 * Created by Supun
 */

describe('User can manage course forum', function() {

    it('Click All sections course forum tabs', function (done) {
        return MM.loginAsStudent().then(function () {
            return MM.clickOnInSideMenu('My courses');
        }).then(function () {
            return MM.clickOn('Psychology in Cinema');
        }).then(function () {
            return MM.clickOn('All sections');
        }).then(function () {
            return MM.clickOn('Announcements from your tutor');
        }).then(function () {
            return MM.goBack();
        }).then(function() {
            done();
        });
    });

    it('View course forum windows', function (done) {
        return MM.loginAsStudent().then(function () {
            return MM.clickOnInSideMenu('My courses')
        }).then(function () {
            return MM.clickOn('Psychology in Cinema');
        }).then(function () {
            return MM.clickOn('Course welcome');
        }).then(function () {
            return MM.clickOn('Announcements from your tutor');
        }).then(function() {
            expect(MM.getView().getText()).toMatch('General news and announcements');
            expect(MM.getView().getText()).toMatch('Group Project');
        }).then(function () {
            return MM.clickOn('General news and announcements');
        }).then(function () {
            expect(MM.getView().getText()).toMatch('General news and announcements');
        }).then(function () {
            return MM.goBack()
        }).then(function() {
            done();
        });
    });

    it('View course Forum grade test windows', function (done) {
        return MM.loginAsStudent().then(function () {
            return MM.clickOnInSideMenu('My courses')
        }).then(function () {
            return MM.clickOn('Psychology in Cinema');
        }).then(function () {
            return MM.clickOn('Course welcome');
        }).then(function () {
            return MM.clickOn('Forum grade test');
        }).then(function() {
            expect(MM.getView().getText()).toMatch('Add a new discussion topic');
            expect(MM.getView().getText()).toMatch('Forum grade test');
        }).then(function () {
            return MM.goBack()
        }).then(function() {
            done();
        });
    });

    it('Add a new discussion topic', function (done) {
        return MM.loginAsStudent().then(function () {
            return MM.clickOnInSideMenu('My courses')
        }).then(function () {
            return MM.clickOn('Psychology in Cinema');
        }).then(function () {
            return MM.clickOn('Course welcome');
        }).then(function () {
            return MM.clickOn('Forum grade test');
        }).then(function () {
            return MM.clickOn('Add a new discussion topic');
        }).then(function() {
            return $('[ng-model="newdiscussion.subject"]').sendKeys('Test Discussion Subject');
        }).then(function() {
            return $('[ng-model="newdiscussion.message"]').sendKeys('Test Discussion Message');
        }).then(function() {
            return $('[ng-click="add()"]').click();
        }).then(function () {
            return MM.goBack()
        }).then(function() {
            done();
        });
    });

    it('Add a new Course discussion', function (done) {
        return MM.loginAsStudent().then(function () {
            return MM.clickOnInSideMenu('My courses')
        }).then(function () {
            return MM.clickOn('Psychology in Cinema');
        }).then(function () {
            return MM.clickOn('Analysis');
        }).then(function () {
            return MM.clickOn('Course discussion');
        }).then(function () {
            return MM.clickOn('Add a new discussion topic');
        }).then(function() {
            return $('[ng-model="newdiscussion.subject"]').sendKeys('Test Subject');
        }).then(function() {
            return $('[ng-model="newdiscussion.message"]').sendKeys('Test Message');
        }).then(function() {
            return $('[ng-click="add()"]').click();
        }).then(function () {
            return MM.goBack()
        }).then(function() {
            done();
        });
    });

    it('Discussions about your group projects', function (done) {
        return MM.loginAsStudent().then(function () {
            return MM.clickOnInSideMenu('My courses')
        }).then(function () {
            return MM.clickOn('Psychology in Cinema');
        }).then(function () {
            return MM.clickOn('Group Projects and Individual tasks');
        }).then(function () {
            return MM.clickOn('Discussions about your group projects');
        }).then(function () {
            return MM.clickOn('Add a new discussion topic');
        }).then(function() {
            return $('[ng-model="newdiscussion.subject"]').sendKeys('Test Group Projects Subject');
        }).then(function() {
            return $('[ng-model="newdiscussion.message"]').sendKeys('Test Group Projects Message');
        }).then(function() {
            return $('[ng-click="add()"]').click();
        }).then(function () {
            return MM.goBack()
        }).then(function() {
            done();
        });
    });

    it('Click secondary button', function (done) {
        return MM.loginAsStudent().then(function () {
            return MM.clickOnInSideMenu('My courses')
        }).then(function () {
            return MM.clickOn('Psychology in Cinema');
        }).then(function () {
            return MM.clickOn('Course welcome');
        }).then(function () {
            return MM.clickOn('Announcements from your tutor');
        }).then(function () {
            return $('.secondary-buttons').click();
        }).then(function() {
            return MM.goBack();
        }).then(function () {
            done();
        });
    });

});

