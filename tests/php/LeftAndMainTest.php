<?php

namespace SilverStripe\Admin\Tests;

use SilverStripe\Admin\AdminRootController;
use SilverStripe\Admin\CMSMenu;
use SilverStripe\Admin\LeftAndMain;
use SilverStripe\Assets\File;
use SilverStripe\Control\HTTPResponse;
use SilverStripe\Core\Config\Config;
use SilverStripe\Core\Manifest\ModuleLoader;
use SilverStripe\Dev\FunctionalTest;
use SilverStripe\Security\Member;
use SilverStripe\View\Requirements;
use SilverStripe\Core\Manifest\VersionedProvider;

class LeftAndMainTest extends FunctionalTest
{
    protected static $fixture_file = 'LeftAndMainTest.yml';

    protected $backupCombined;

    protected function setUp(): void
    {
        parent::setUp();

        // @todo fix controller stack problems and re-activate
        //$this->autoFollowRedirection = false;
        $this->resetMenu();
        $this->backupCombined = Requirements::get_combined_files_enabled();
        $base = ModuleLoader::inst()->getManifest()->getModule('silverstripe/admin');
        $assetsDir = File::join_paths($base->getRelativePath(), 'tests/php/assets');

        LeftAndMain::config()
            ->update('extra_requirements_css', array(
                $assetsDir.'/LeftAndMainTest.css'
            ))
            ->update('extra_requirements_javascript', array(
                $assetsDir. '/LeftAndMainTest.js'
            ));

        Requirements::set_combined_files_enabled(false);
    }

    /**
     * Clear menu to default state as per LeftAndMain::init()
     */
    protected function resetMenu()
    {
        CMSMenu::clear_menu();
        CMSMenu::populate_menu();
    }

    protected function tearDown(): void
    {
        parent::tearDown();
        Requirements::set_combined_files_enabled($this->backupCombined);
    }

    public function testExtraCssAndJavascript()
    {
        $admin = $this->objFromFixture(Member::class, 'admin');
        $this->logInAs($admin);
        $response = $this->get('admin/security');

        $this->assertMatchesRegularExpression(
            '/tests\/php\/assets\/LeftAndMainTest.css/i',
            $response->getBody(),
            "body should contain custom css"
        );
        $this->assertMatchesRegularExpression(
            '/tests\/php\/assets\/LeftAndMainTest.js/i',
            $response->getBody(),
            "body should contain custom js"
        );
    }

    /**
     * Check that subclasses of LeftAndMain can be accessed
     */
    public function testLeftAndMainSubclasses()
    {
        $this->logInWithPermission('ADMIN');
        $this->resetMenu();

        $menuItems = LeftAndMain::singleton()->MainMenu(false);
        $this->assertGreaterThan(0, count($menuItems));

        $adminUrl = AdminRootController::admin_url();
        $menuItem = $menuItems->find('Link', $adminUrl . 'security/');
        $this->assertNotEmpty($menuItem, 'Security not found in the menu items list');

        $link = $menuItem->Link;
        $response = $this->get($link);

        $this->assertInstanceOf(HTTPResponse::class, $response, "$link should return a response object");
        $this->assertEquals(200, $response->getStatusCode(), "$link should return 200 status code");
        // Check that a HTML page has been returned
        $this->assertMatchesRegularExpression('/<html[^>]*>/i', $response->getBody(), "$link should contain <html> tag");
        $this->assertMatchesRegularExpression('/<head[^>]*>/i', $response->getBody(), "$link should contain <head> tag");
        $this->assertMatchesRegularExpression('/<body[^>]*>/i', $response->getBody(), "$link should contain <body> tag");
    }

    public function testCanView()
    {
        $adminuser = $this->objFromFixture(Member::class, 'admin');
        $securityonlyuser = $this->objFromFixture(Member::class, 'securityonlyuser');
        $allcmssectionsuser = $this->objFromFixture(Member::class, 'allcmssectionsuser');

        // anonymous user
        $this->logOut();
        $this->resetMenu();
        $menuItems = LeftAndMain::singleton()->MainMenu(false);
        $this->assertEquals(
            $menuItems->column('Code'),
            array(),
            'Without valid login, members cant access any menu entries'
        );

        // restricted cms user
        $this->logInAs($securityonlyuser);
        $this->resetMenu();
        $menuItems = LeftAndMain::singleton()->MainMenu(false);
        $menuItems = $menuItems->column('Code');
        sort($menuItems);

        $this->assertEquals(
            array(
                'SilverStripe-Admin-CMSProfileController',
                'SilverStripe-Admin-SecurityAdmin'
            ),
            $menuItems,
            'Groups with limited access can only access the interfaces they have permissions for'
        );

        // all cms sections user
        $this->logInAs($allcmssectionsuser);
        $this->resetMenu();
        $menuItems = LeftAndMain::singleton()->MainMenu(false);
        $this->assertContains(
            'SilverStripe-Admin-CMSProfileController',
            $menuItems->column('Code'),
            'Group with CMS_ACCESS_SilverStripe\\Admin\\LeftAndMain permission can edit own profile'
        );
        $this->assertContains(
            'SilverStripe-Admin-SecurityAdmin',
            $menuItems->column('Code'),
            'Group with CMS_ACCESS_SilverStripe\\Admin\\LeftAndMain permission can access all sections'
        );

        // admin
        $this->logInAs($adminuser);
        $this->resetMenu();
        $menuItems = LeftAndMain::singleton()->MainMenu(false);
        $this->assertContains(
            'SilverStripe-Admin-SecurityAdmin',
            $menuItems->column('Code'),
            'Administrators can access Security Admin'
        );

        $this->logOut();
    }

    /**
     * Test that getHelpLinks transforms $help_links into the correct format
     */
    public function testGetHelpLinks()
    {
        Config::modify()
            // Remove any deprecated help_link definitions
            ->remove(LeftAndMain::class, 'help_link')
            ->set(LeftAndMain::class, 'help_links', [
                'SilverStripe' => 'www.silverstripe.org',
            ]);

        $helpLinks = LeftAndMain::singleton()->getHelpLinks();
        $this->assertCount(1, $helpLinks, 'Unexpected number of help links found');

        $silverstripeLink = $helpLinks->first();

        $this->assertEquals('SilverStripe', $silverstripeLink['Title']);
        $this->assertEquals('www.silverstripe.org', $silverstripeLink['URL']);
    }

    /**
     * @dataProvider provideTestCMSVersionNumber
     */
    public function testCMSVersionNumber($frameworkVersion, $expected)
    {
        $versionProvider = $this
            ->getMockBuilder(VersionProvider::class)
            ->setMethods(['getModules', 'getModuleVersionFromComposer'])
            ->getMock();
        $data = ['silverstripe/framework' => $frameworkVersion];
        $versionProvider->method('getModules')->willReturn($data);
        $versionProvider->method('getModuleVersionFromComposer')->willReturn($data);
        $leftAndMain = $this
            ->getMockBuilder(LeftAndMain::class)
            ->setMethods(['getVersionProvider'])
            ->getMock();
        $leftAndMain->method('getVersionProvider')->willReturn($versionProvider);
        $this->assertSame($expected, $leftAndMain->CMSVersionNumber());
    }

    /**
     * @return array
     */
    public function provideTestCMSVersionNumber()
    {
        return [
            ['4.9.1', '4.9'],
            ['4.10.5', '4.10'],
            ['4.236.7', '4.236'],
            ['4.9.x-dev', '4.9'],
            ['4.10.x-dev', '4.10'],
            ['myfork', 'myfork'],
        ];
    }
}
