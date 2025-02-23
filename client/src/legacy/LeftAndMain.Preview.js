import $ from 'jquery';
import i18n from 'i18n';

$.entwine('ss.preview', function($){

  /**
   * Shows a previewable website state alongside its editable version in backend UI.
   *
   * Relies on the server responses to indicate if a preview is available for the
   * currently loaded admin interface - signified by class ".cms-previewable" being present.
   *
   * The preview options at the bottom are constructured by grabbing a SilverStripeNavigator
   * structure also provided by the backend.
   */
  $('.cms-preview').entwine({

    /**
     * List of SilverStripeNavigator states (SilverStripeNavigatorItem classes) to search for.
     * The order is significant - if the state is not available, preview will start searching the list
     * from the beginning.
     */
    AllowedStates: ['StageLink', 'LiveLink', 'Unversioned', 'ArchiveLink'],

    /**
     * API
     * Name of the current preview state - one of the "AllowedStates".
     */
    CurrentStateName: null,

    /**
     * API
     * Current size selection.
     */
    CurrentSizeName: 'auto',

    /**
     * Flags whether the preview is available on this CMS section.
     */
    IsPreviewEnabled: false,

    /**
     * Mode in which the preview will be enabled.
     */
    DefaultMode: 'split',

    Sizes: {
      auto: {
        width: '100%',
        height: '100%'
      },
      mobile: {
        width: '335px', // add 15px for approx desktop scrollbar
        height: '568px'
      },
      mobileLandscape: {
        width: '583px', // add 15px for approx desktop scrollbar
        height: '320px'
      },
      tablet: {
        width: '783px', // add 15px for approx desktop scrollbar
        height: '1024px'
      },
      tabletLandscape: {
        width: '1039px', // add 15px for approx desktop scrollbar
        height: '768px'
      },
      desktop: {
        width: '1024px',
        height: '800px'
      }
    },

    /**
     * API
     * Switch the preview to different state.
     * stateName can be one of the "AllowedStates".
     *
     * @param {String}
     * @param {Boolean} Set to FALSE to avoid persisting the state
     */
    changeState: function(stateName, save) {
      var self = this, states = this._getNavigatorStates();
      if(save !== false) {
        $.each(states, function(index, state) {
          self.saveState('state', stateName);
        });
      }

      this.setCurrentStateName(stateName);
      this._loadCurrentState();
      this.redraw();

      return this;
    },

    /**
     * API
     * Change the preview mode.
     * modeName can be: split, content, preview.
     */
    changeMode: function(modeName, save) {
      var container = $('.cms-container').entwine('.ss');

      if (modeName == 'split') {
        container.splitViewMode();
        this.setIsPreviewEnabled(true);
        this._loadCurrentState();
      } else if (modeName == 'content') {
        container.contentViewMode();
        this.setIsPreviewEnabled(false);
        // Do not load content as the preview is not visible.
      } else if (modeName == 'preview') {
        container.previewMode();
        this.setIsPreviewEnabled(true);
        this._loadCurrentState();
      } else {
        throw 'Invalid mode: ' + modeName;
      }

      if(save !== false) this.saveState('mode', modeName);

      this.redraw();

      return this;
    },

    /**
     * API
     * Change the preview size.
     * sizeName can be: auto, desktop, tablet, mobile.
     */
    changeSize: function(sizeName) {
      var sizes = this.getSizes();

      this.setCurrentSizeName(sizeName);
      this.removeClass('auto desktop tablet mobile').addClass(sizeName);

      this.saveState('size', sizeName);

      this.redraw();

      return this;
    },

    /**
     * API
     * Update the visual appearance to match the internal preview state.
     */
    redraw: function() {

      if(window.debug) console.log('redraw', this.attr('class'), this.get(0));

      // Update preview state selector.
      var currentStateName = this.getCurrentStateName();
      if (currentStateName) {
        this.find('.cms-preview-states').changeVisibleState(currentStateName);
      }

      // Update preview mode selectors.
      var layoutOptions = $('.cms-container').entwine('.ss').getLayoutOptions();
      if (layoutOptions) {
        // There are two mode selectors that we need to keep in sync. Redraw both.
        $('.preview-mode-selector').changeVisibleMode(layoutOptions.mode);
      }

      // Update preview size selector.
      var currentSizeName = this.getCurrentSizeName();
      if (currentSizeName) {
        this.find('.preview-size-selector').changeVisibleSize(this.getCurrentSizeName());
      }

      return this;
    },

    /**
     * Store the preview options for this page.
     */
    saveState : function(name, value) {
      if(this._supportsLocalStorage()) window.localStorage.setItem('cms-preview-state-' + name, value);
    },

    /**
     * Load previously stored preferences
     */
    loadState : function(name) {
      if(this._supportsLocalStorage()) return window.localStorage.getItem('cms-preview-state-' + name);
    },

    /**
     * Disable the area - it will not appear in the GUI.
     * Caveat: the preview will be automatically enabled when ".cms-previewable" class is detected.
     */
    disablePreview: function() {
      this.setPendingURL(null);
      this._loadUrl('about:blank');
      this._block();
      this.changeMode('content', false);
      this.setIsPreviewEnabled(false);
      return this;
    },

    /**
     * Enable the area and start updating to reflect the content editing.
     */
    enablePreview: function() {
      if (!this.getIsPreviewEnabled()) {
        this.setIsPreviewEnabled(true);

        // Initialise mode.
        this.changeMode(this.getDefaultMode(), false);
      }
      return this;
    },

    /**
     * Initialise the preview element.
     */
    onadd: function() {
      var self = this, iframe = this.find('iframe');

      // Create layout and controls
      iframe.addClass('center');
      iframe.bind('load', function() {
        self._adjustIframeForPreview();

        // Load edit view for new page, but only if the preview is activated at the moment.
        // This avoids e.g. force-redirections of the edit view on RedirectorPage instances.
        self._loadCurrentPage();

        $(this).removeClass('loading');
      });

      // Preview might not be available in all admin interfaces - block/disable when necessary
      this._unblock();

      this.disablePreview();

      this._super();
    },

    /**
    * Detect and use localStorage if available. In IE11 windows 8.1 call to window.localStorage was throwing out an access denied error in some cases which was causing the preview window not to display correctly in the CMS admin area.
    */
    _supportsLocalStorage: function() {
      var uid = new Date;
      var storage;
      var result;
      try {
        (storage = window.localStorage).setItem(uid, uid);
        result = storage.getItem(uid) == uid;
        storage.removeItem(uid);
        return result && storage;
      } catch (exception) {
        console.warn('localStorge is not available due to current browser / system settings.');
      }
    },

    onforcecontent: function () {
      this.changeMode('content', false);
    },

    onenable: function () {
      var $viewModeSelector = $('.preview-mode-selector');

      $viewModeSelector.removeClass('split-disabled');
      $viewModeSelector.find('.disabled-tooltip').hide();
    },

    ondisable: function () {
      var $viewModeSelector = $('.preview-mode-selector');

      $viewModeSelector.addClass('split-disabled');
      $viewModeSelector.find('.disabled-tooltip').show();
    },

    /**
     * Set the preview to unavailable - could be still visible. This is purely visual.
     */
    _block: function() {
      this.find('.preview-note').show();
      return this;
    },

    /**
     * Set the preview to available (remove the overlay);
     */
    _unblock: function() {
      this.find('.preview-note').hide();
      return this;
    },

    /**
     * Update the preview according to browser and CMS section capabilities.
     */
    _initialiseFromContent: function() {
      var mode, size;

      if (!$('.cms-previewable').length) {
        this.disablePreview();
      } else {
        mode = this.loadState('mode');
        size = this.loadState('size');

        this._moveNavigator();
        if(!mode || mode != 'content') {
          this.enablePreview();
          this._loadCurrentState();
        }
        this.redraw();

        // now check the cookie to see if we have any preview settings that have been
        // retained for this page from the last visit
        if(mode) this.changeMode(mode);
        if(size) this.changeSize(size);
      }
      return this;
    },

    /**
     * Update preview whenever any panels are reloaded.
     */
    'from .cms-container': {
      onafterstatechange: function(e, data) {
        // Don't update preview if we're dealing with a custom redirect
        if(data.xhr.getResponseHeader('X-ControllerURL')) return;

        this._initialiseFromContent();
      }
    },

    /** @var string A URL that should be displayed in this preview panel once it becomes visible */
    PendingURL: null,

    oncolumnvisibilitychanged: function() {
      var url = this.getPendingURL();
      if (url && !this.is('.column-hidden')) {
        this.setPendingURL(null);
        this._loadUrl(url);
        this._unblock();
      }
    },

    /**
     * Update preview whenever a form is submitted.
     * This is an alternative to the LeftAndmMain::loadPanel functionality which we already
     * cover in the onafterstatechange handler.
     */
    'from .cms-container .cms-edit-form': {
      onaftersubmitform: function(){
        this._initialiseFromContent();
      }
    },

    /**
     * Change the URL of the preview iframe (if its not already displayed).
     */
    _loadUrl: function(url) {
      this.find('iframe').addClass('loading').attr('src', url);
      return this;
    },

    /**
     * Fetch available states from the current SilverStripeNavigator (SilverStripeNavigatorItems).
     * Navigator is supplied by the backend and contains all state options for the current object.
     */
    _getNavigatorStates: function() {
      // Walk through available states and get the URLs.
      var urlMap = $.map(this.getAllowedStates(), function(name) {
        var stateLink = $('.cms-preview-states .state-name[data-name=' + name + ']');
        if(stateLink.length) {
          return {
            name: name,
            url: stateLink.attr('href'),
            active: stateLink.hasClass('active')
          };
        } else {
          return null;
        }
      });

      return urlMap;
    },

    /**
     * Load current state into the preview (e.g. StageLink or LiveLink).
     * We try to reuse the state we have been previously in. Otherwise we fall back
     * to the first state available on the "AllowedStates" list.
     *
     * @returns New state name.
     */
    _loadCurrentState: function() {
      if (!this.getIsPreviewEnabled()) return this;

      var states = this._getNavigatorStates();
      var currentStateName = this.getCurrentStateName();
      var currentState = null;

      // Find current state within currently available states.
      if (states) {
        currentState = $.grep(states, function(state, index) {
          return (
            currentStateName === state.name ||
            (!currentStateName && state.active)
          );
        });
      }

      var url = null;

      if (currentState[0]) {
        // State is available on the newly loaded content. Get it.
        url = currentState[0].url;
      } else if (states.length) {
        // Fall back to the first available content state.
        this.setCurrentStateName(states[0].name);
        url = states[0].url;
      } else {
        // No state available at all.
        this.setCurrentStateName(null);
      }

      // Mark url as a preview url so it can get special treatment
      if (url) {
        let urlFrag = url.split('#');
        const urlBits = urlFrag.shift().split(/[?&]/);
        const urlBase = urlBits.shift();
        urlBits.push('CMSPreview=1');
        urlFrag = urlFrag.length ? '#' + urlFrag.join('#') : '';
        url = urlBase + '?' + urlBits.join('&') + urlFrag;
      }

      // If this preview panel isn't visible at the moment, delay loading the URL until it (maybe) is later
      if (this.is('.column-hidden')) {
        this.setPendingURL(url);
        this._loadUrl('about:blank');
        this._block();
      }
      else {
        this.setPendingURL(null);

        if (url) {
          this._loadUrl(url);
          this._unblock();
        }
        else {
          this._loadUrl('about:blank');
          this._block();
        }
      }

      return this;
    },

    /**
     * Move the navigator from the content to the preview bar.
     */
    _moveNavigator: function() {
      var previewEl = $('.cms-preview .cms-preview-controls');
      var navigatorEl = $('.cms-edit-form .cms-navigator');

      if (navigatorEl.length && previewEl.length) {
        // Navigator is available - install the navigator.
        previewEl.html($('.cms-edit-form .cms-navigator').detach());
      } else {
        // Navigator not available.
        this._block();
      }
    },

    /**
     * Loads the matching edit form for a page viewed in the preview iframe,
     * based on metadata sent along with this document.
     */
    _loadCurrentPage: function() {
      if (!this.getIsPreviewEnabled()) return;

      var doc,
        containerEl = $('.cms-container');
      try {
        doc = this.find('iframe')[0].contentDocument;
      } catch (e) {
        // iframe can't be accessed - might be secure?
        console.warn('Unable to access iframe, possible https mis-match');
      }
      if (!doc) {
        return;
      }

      // Load this page in the admin interface if appropriate
      var id = $(doc).find('meta[name=x-page-id]').attr('content');
      var editLink = $(doc).find('meta[name=x-cms-edit-link]').attr('content');
      var contentPanel = $('.cms-content');

      if(id && contentPanel.find(':input[name=ID]').val() != id) {
        // Ignore behaviour without history support (as we need ajax loading
        // for the new form to load in the background)
        $('.cms-container').entwine('.ss').loadPanel(editLink);
      }
    },

    /**
     * Prepare the iframe content for preview.
     */
    _adjustIframeForPreview: function() {
      var iframe = this.find('iframe')[0],
        doc;
      if(!iframe){
        return;
      }

      try {
        doc = iframe.contentDocument;
      } catch (e) {
        // iframe can't be accessed - might be secure?
        console.warn('Unable to access iframe, possible https mis-match');
      }
      if(!doc) {
        return;
      }

      // Open external links in new window to avoid "escaping" the internal page context in the preview
      // iframe, which is important to stay in for the CMS logic.
      var links = doc.getElementsByTagName('A');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href');
        if(!href) continue;

        if (href.match(/^http:\/\//)) links[i].setAttribute('target', '_blank');
      }

      // Hide the navigator from the preview iframe and use only the CMS one.
      var navi = doc.getElementById('SilverStripeNavigator');
      if(navi) navi.style.display = 'none';
      var naviMsg = doc.getElementById('SilverStripeNavigatorMessage');
      if(naviMsg) naviMsg.style.display = 'none';

      // Trigger extensions.
      this.trigger('afterIframeAdjustedForPreview', [ doc ]);
    }
  });

  $('.cms-edit-form').entwine({
    onadd: function() {
      this._super();
      $('.cms-preview')._initialiseFromContent();
    }
  });

  /**
   * "Preview state" functions.
   * -------------------------------------------------------------------
   */
  $('.cms-preview-states').entwine({
    /**
     * Change the appearance of the state selector.
     */
    changeVisibleState: function(state) {
      this.find('[data-name="'+state+'"]').addClass('active').siblings().removeClass('active');
    }
  });

  $('.cms-preview-states .state-name').entwine({
    /**
     * Reacts to the user changing the state of the preview.
     */
    onclick: function(e) {
      //only intercept left click, so middle click can open new windows
      if (e.which == 1) {
        var targetStateName = $(this).attr('data-name');

        //Add and remove classes to make switch work ok in old IE
        this.addClass('active').siblings().removeClass('active');

        // Reload preview with the selected state.
        $('.cms-preview').changeState(targetStateName);

        e.preventDefault();
      }
    }
  });

  /**
   * "Preview mode" functions
   * -------------------------------------------------------------------
   */
  $('.preview-mode-selector').entwine({
    /**
     * Change the appearance of the mode selector.
     */
    changeVisibleMode: function(mode) {
      this.find('select')
        .val(mode)
        .trigger('chosen:updated')
        ._addIcon();
    }
  });

  $('.preview-mode-selector select').entwine({
    /**
     * Reacts to the user changing the preview mode.
     */
    onchange: function(e) {
      this._super(e);
      e.preventDefault();

      var targetStateName = $(this).val();
      $('.cms-preview').changeMode(targetStateName);
    }
  });

  /**
   * Adjust the visibility of the preview-mode selector in the CMS part (hidden if preview is visible).
   */
  $('.cms-container--content-mode').entwine({
    onmatch: function() {
      // Alert the user as to why the preview is hidden
      if ($('.cms-preview .result-selected').hasClass('font-icon-columns')) {
        statusMessage(i18n._t(
          'Admin.DISABLESPLITVIEW',
          "Screen too small to show site preview in split mode"),
        "error");
      }
      this._super();
    }
  });

  /**
   * "Preview size" functions
   * -------------------------------------------------------------------
   */
  $('.preview-size-selector').entwine({
    /**
     * Change the appearance of the size selector.
     */
    changeVisibleSize: function(size) {
      this.find('select')
        .val(size)
        .trigger('chosen:updated')
        ._addIcon();
    }
  });

  $('.preview-size-selector select').entwine({
    /**
     * Trigger change in the preview size.
     */
    onchange: function(e) {
      e.preventDefault();

      var targetSizeName = $(this).val();
      $('.cms-preview').changeSize(targetSizeName);
    }
  });


  /**
   * "Chosen" plumbing.
   * -------------------------------------------------------------------
   */

  /*
  *  Add a class to the chosen select trigger based on the currently
  *  selected option. Update as this changes
  */
  $('.preview-selector select.preview-dropdown').entwine({
    /**
     * Trigger additional initial icon update when the control is fully loaded.
     * Solves an IE8 timing issue.
     */
    'onchosen:ready': function() {
      this._super();
      this._addIcon();
    },

    _addIcon: function(){
      var selected = this.find(':selected');
      var iconClass = selected.attr('data-icon');

      var target = this.parent().find('.chosen-container a.chosen-single');
      var oldIcon = target.attr('data-icon');
      if(typeof oldIcon !== 'undefined'){
        target.removeClass(oldIcon);
      }
      target.addClass(iconClass);
      target.attr('data-icon', iconClass);

      return this;
    }
  });

  $('.preview-mode-selector .chosen-drop li:last-child').entwine({
    onmatch: function () {
      if ($('.preview-mode-selector').hasClass('split-disabled')) {
        this.parent().append('<div class="disabled-tooltip"></div>');
      } else {
        this.parent().append('<div class="disabled-tooltip" style="display: none;"></div>');
      }
    }
  });



  /**
   * Rotate preview to landscape
   */
  $('.preview-device-outer').entwine({
    onclick: function () {
      this.parent('.preview__device').toggleClass('rotate');
    }
  });
});
