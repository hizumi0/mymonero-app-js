// Copyright (c) 2014-2017, MyMonero.com
//
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without modification, are
// permitted provided that the following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice, this list of
//	conditions and the following disclaimer.
//
// 2. Redistributions in binary form must reproduce the above copyright notice, this list
//	of conditions and the following disclaimer in the documentation and/or other
//	materials provided with the distribution.
//
// 3. Neither the name of the copyright holder nor the names of its contributors may be
//	used to endorse or promote products derived from this software without specific
//	prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
// EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
// THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
// PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
// STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
// THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

"use strict"
//
const async = require('async')
const EventEmitter = require('events')
//
const symmetric_string_cryptor = require('../../symmetric_cryptor/symmetric_string_cryptor')
//
const CollectionName = "PasswordMeta"
const plaintextMessageToSaveForUnlockChallenges = "this is just a string that we'll use for checking whether a given password can unlock an encrypted version of this very message"
const _userSelectedTypesOfPassword =
{
	FreeformStringPW: "FreeformStringPW", // this goes first as it's recommended to users
	SixCharPIN: "SixCharPIN"
}
const _humanReadable_AvailableUserSelectableTypesOfPassword =
{
	FreeformStringPW: "password",
	SixCharPIN: "PIN"
}
//
//
// Controller
//
class PasswordController extends EventEmitter
{


	////////////////////////////////////////////////////////////////////////////////
	// Lifecycle - Initialization

	constructor(options, context)
	{
		super()
		// ^--- have to call super before can access `this`
		//
		const self = this
		self.options = options
		self.context = context
		//
		self.deleteEverythingRegistrants = []
		//
		self.hasBooted = false
		self.password = undefined // it's not been obtained from the user yet - we only store it in memory
		//
		self.setupAndBoot()
	}
	setupAndBoot()
	{ // we can afford to do this w/o any callback saying "success" because we defer execution of
	  // things which would rely on boot-time info till we've booted
		const self = this
		//
		// first, check if any password model has been stored
		self.context.persister.DocumentsWithQuery(
			CollectionName,
			{}, // all objects - tho we're expecting 0 or 1
			{}, // opts
			function(err, docs)
			{
				if (err) {
					console.error("Error while fetching existing", CollectionName, err)
					throw err
					return
				}
				const docs_length = docs.length
				if (docs_length === 0) { //
					const mocked_doc =
					{
						userSelectedTypeOfPassword: self.AvailableUserSelectableTypesOfPassword().FreeformStringPW // default…… for desktop anyway. this might change based on UX direction
					}
					_proceedTo_loadStateFromModel(
						false, // never entered pw before
						mocked_doc
					)
					return
				}
				if (docs_length > 1) {
					const errStr = "Error while fetching existing " + CollectionName + "... more than one PasswordModel found. Selecting first."
					console.error(errStr)
					// this is indicative of a code fault
				}
				const doc = docs[0]
				// console.log("💬  Found existing saved password model with _id", doc._id)
				_proceedTo_loadStateFromModel(
					true,
					doc
				)
			}
		)
		function _proceedTo_loadStateFromModel(
			hasUserEverEnteredPassword,
			passwordModel_doc
		)
		{
			self.hasUserEverEnteredPassword = hasUserEverEnteredPassword
			//
			self._id = passwordModel_doc._id || undefined
			self.userSelectedTypeOfPassword = passwordModel_doc.userSelectedTypeOfPassword
			self.encryptedMessageForUnlockChallenge = passwordModel_doc.encryptedMessageForUnlockChallenge
			if (self._id !== null && typeof self._id !== 'undefined') { // existing doc
				if (typeof self.encryptedMessageForUnlockChallenge === 'undefined' || !self.encryptedMessageForUnlockChallenge) { // but it was saved w/o an encrypted challenge str
					const errStr = "Found undefined encrypted msg for unlock challenge in saved password model document" // TODO: not sure how to handle this case. delete all local info? would suck
					console.error(errStr)
					throw errStr
					return
				}
			}
			self._initial_waitingForFirstPWEntryDecode_passwordModel_doc = passwordModel_doc // this will be nil'd after it's been parsed once the user has entered their pw
			self.hasBooted = true // all done!
		}
	}
	_overridable_init_loadStateFromModel(
		passwordModel_doc, 
		fn // (err?) -> Void
	)
	{ // see PasswordAndSettingsController
		const self = this
		fn(null) // no err
	}
	//
	//
	// Setup - Called on post-whole-context-boot (see Delegation below)
	//
	_startObserving_userIdleInWindowController()
	{
		const self = this
		const controller = self.context.userIdleInWindowController
		if (typeof controller === 'undefined' || controller === null) {
			throw "nil self.context.userIdleInWindowController"
		}
		controller.on(
			controller.EventName_userDidBecomeIdle(),
			function()
			{
				if (self.hasUserEverEnteredPassword !== true) {
					// nothing to do here because the app is not unlocked and/or has no data which would be locked
					console.log("💬  User became idle but no password has ever been entered/no saved data should exist.")
					return
				} else if (self.HasUserEnteredValidPasswordYet() !== true) {
					// user has saved data but hasn't unlocked the app yet
					console.log("💬  User became idle and saved data/pw exists, but user hasn't unlocked app yet.")
					return
				}
				self._didBecomeIdleAfterHavingPreviouslyEnteredPassword()
			}
		)
	}


	////////////////////////////////////////////////////////////////////////////////
	// Runtime - Accessors - Public
	
	// either
	EventName_SetFirstPasswordDuringThisRuntime()
	{
		return "EventName_SetFirstPasswordDuringThisRuntime"
	}
	// or
	EventName_ChangedPassword()
	{
		return "EventName_ChangedPassword"
	}
	//
	//
	EventName_ObtainedNewPassword()
	{
		return "EventName_ObtainedNewPassword"
	}
	EventName_ObtainedCorrectExistingPassword()
	{
		return "EventName_ObtainedCorrectExistingPassword"
	}
	EventName_ErroredWhileSettingNewPassword()
	{
		return "EventName_ErroredWhileSettingNewPassword"
	}
	EventName_ErroredWhileGettingExistingPassword()
	{
		return "EventName_ErroredWhileGettingExistingPassword"
	}
	EventName_errorWhileChangingPassword()
	{
		return "EventName_errorWhileChangingPassword"
	}
	EventName_SingleObserver_getUserToEnterExistingPasswordWithCB()
	{
		return "EventName_SingleObserver_getUserToEnterExistingPasswordWithCB"
	}
	EventName_SingleObserver_getUserToEnterNewPasswordAndTypeWithCB()
	{
		return "EventName_SingleObserver_getUserToEnterNewPasswordAndTypeWithCB"
	}
	//
	EventName_willDeconstructBootedStateAndClearPassword()
	{
		return "EventName_willDeconstructBootedStateAndClearPassword"
	}
	EventName_didDeconstructBootedStateAndClearPassword()
	{
		return "EventName_didDeconstructBootedStateAndClearPassword"
	}
	EventName_havingDeletedEverything_didDeconstructBootedStateAndClearPassword()
	{
		return "EventName_havingDeletedEverything_didDeconstructBootedStateAndClearPassword"
	}
	//
	
	//
	AvailableUserSelectableTypesOfPassword()
	{
		return _userSelectedTypesOfPassword
	}
	HumanReadable_AvailableUserSelectableTypesOfPassword()
	{
		return _humanReadable_AvailableUserSelectableTypesOfPassword
	}
	Capitalized_HumanReadable_AvailableUserSelectableTypeOfPassword(passwordType)
	{
		const humanReadable_passwordType = _humanReadable_AvailableUserSelectableTypesOfPassword[passwordType]
		function __capitalizedString(str)
		{
			return str.charAt(0).toUpperCase() + str.slice(1)
		}
		//
	    return __capitalizedString(humanReadable_passwordType)
	}
	//
	HasUserEnteredValidPasswordYet()
	{
		const self = this
		if (typeof self.password === 'undefined' || self.password === null || self.password === "") {
			return false
		} else {
			return true
		}
	}
	IsUserChangingPassword()
	{
		const self = this
		const is = self.HasUserEnteredValidPasswordYet() && self.isAlreadyGettingExistingOrNewPWFromUser === true
		//
		return is
	}
	//
	DetectedPasswordTypeFromPassword(password)
	{
		const self = this
		{
			if (password.length === 6) { // if is 6 chars…
				if (/^\d+$/.test(password) === true) { // and contains only numbers
					return self.AvailableUserSelectableTypesOfPassword().SixCharPIN
				}
			}
		}
		return self.AvailableUserSelectableTypesOfPassword().FreeformStringPW
	}
	


	////////////////////////////////////////////////////////////////////////////////
	// Runtime - Imperatives - Public - Password management

	WhenBootedAndPasswordObtained_PasswordAndType(
		fn // (password, passwordType) -> Void
	)
	{ // this function is for convenience to wrap consumers' waiting for password readiness
		const self = this
		self._executeWhenBooted(
			function()
			{
				function callBack()
				{
					fn(self.password, self.userSelectedTypeOfPassword)
				}
				if (self.HasUserEnteredValidPasswordYet() === true) {
					callBack()
					return 
				}
				// then we have to wait for it
				var hasObtainedPassword = false
				// declaring functions for listeners so we can also unsubscribe
				var onFn_ObtainedNewPassword_fn;
				var onFn_ObtainedCorrectExistingPassword_fn;
				function _aPasswordWasObtained()
				{
					// immediately unsubscribe
					self.removeListener(self.EventName_ObtainedNewPassword(), onFn_ObtainedNewPassword_fn)
					self.removeListener(self.EventName_ObtainedCorrectExistingPassword(), onFn_ObtainedCorrectExistingPassword_fn)
					// guard call to callBack()
					if (hasObtainedPassword === true) {
						console.log("PasswordController/WhenBootedAndPasswordObtained_PasswordAndType _aPasswordWasObtained called redundantly")
						return // ^- shouldn't happen but just in case…
					}
					hasObtainedPassword = true
					//
					callBack()
				}
				onFn_ObtainedNewPassword_fn = function()
				{
					_aPasswordWasObtained()
				}
				onFn_ObtainedCorrectExistingPassword_fn = function()
				{
					_aPasswordWasObtained()
				}
				self.on(self.EventName_ObtainedNewPassword(), onFn_ObtainedNewPassword_fn)
				self.on(self.EventName_ObtainedCorrectExistingPassword(), onFn_ObtainedCorrectExistingPassword_fn)
				//
				// now that we're subscribed, initiate the pw request
				self.OnceBooted_GetNewPasswordAndTypeOrExistingPasswordFromUserAndEmitIt()
			}
		)
	}
	OnceBooted_GetNewPasswordAndTypeOrExistingPasswordFromUserAndEmitIt()
	{ // This function must be called in order to initiate a password entry screen being shown to the user
	  // and to initiate any "password obtained" emits
		const self = this
		self._executeWhenBooted(
			function()
			{
				if (self.HasUserEnteredValidPasswordYet() === true) {
					return // already got it
				}
				{ // guard
					if (self.isAlreadyGettingExistingOrNewPWFromUser === true) {
						console.warn("⚠️  isAlreadyGettingExistingOrNewPWFromUser=true. Exiting instead of re-initiating.")
						return // only need to wait for it to be obtained
					}
					self.isAlreadyGettingExistingOrNewPWFromUser = true
				}
				// we'll use this in a couple places
				const isForChangePassword = false // this is simply for requesting to have the existing or a new password from the user				
				//
				if (typeof self._id === 'undefined' || self._id === null) { // if the user is not unlocking an already pw-protected app
					// then we need to get a new PW from the user
					self.obtainNewPasswordFromUser(isForChangePassword) // this will also call self.unguard_getNewOrExistingPassword()
					return
				} else { // then we need to get the existing PW and check it against the encrypted message
					//
					if (typeof self.encryptedMessageForUnlockChallenge === 'undefined' && !self.encryptedMessageForUnlockChallenge) {
						const errStr = "Code fault: Existing document but no encryptedMessageForUnlockChallenge"
						console.error(errStr)
						self.unguard_getExistingPassword()
						throw errStr
						return
					}	
					self._getUserToEnterTheirExistingPassword(
						isForChangePassword,
						function(userDidCancel_orNil, existingPassword)
						{
							if (userDidCancel_orNil === true) {
								self.unguard_getNewOrExistingPassword()
								return // just silently exit after unguarding
							}
							symmetric_string_cryptor.DecryptedPlaintextString__Async(
								self.encryptedMessageForUnlockChallenge,
								existingPassword,
								function(err, decryptedMessageForUnlockChallenge)
								{
									if (err) {
										const errStr = "Incorrect password"
										const err_toReturn = new Error(errStr)
										self.unguard_getNewOrExistingPassword()
										self.emit(self.EventName_ErroredWhileGettingExistingPassword(), err_toReturn)
										return
									}
									if (decryptedMessageForUnlockChallenge !== plaintextMessageToSaveForUnlockChallenges) {
										const errStr = "Incorrect password"
										const err = new Error(errStr)
										self.unguard_getNewOrExistingPassword()
										self.emit(self.EventName_ErroredWhileGettingExistingPassword(), err)
										return
									}
									//
									self._didObtainPassword(
										existingPassword,
										function(err)
										{
											if (err) {
												self.unguard_getNewOrExistingPassword()
												self.emit(self.EventName_ErroredWhileGettingExistingPassword(), err)
												return
											}
											// yes, that looks good
											self.unguard_getNewOrExistingPassword()
											self.emit(self.EventName_ObtainedCorrectExistingPassword())
										}
									) // hang onto pw and set state
								}
							)
						}
					)
				}
			}
		)
	}
	InitiateChangePassword()
	{
		const self = this
		self._executeWhenBooted(function()
		{
			if (self.HasUserEnteredValidPasswordYet() === false) {
				const errStr = "InitiateChangePassword called but HasUserEnteredValidPasswordYet === false. This should be disallowed in the UI"
				throw errStr
				return
			}
			{ // guard
				if (self.isAlreadyGettingExistingOrNewPWFromUser === true) {
					const errStr = "InitiateChangePassword called but isAlreadyGettingExistingOrNewPWFromUser === true. This should be precluded in the UI"
					throw errStr
					return // only need to wait for it to be obtained
				}
				self.isAlreadyGettingExistingOrNewPWFromUser = true
			}
			// ^-- we're relying on having checked above that user has entered a valid pw already
			const isForChangePassword = true // we'll use this in a couple places
			self._getUserToEnterTheirExistingPassword(
				isForChangePassword,
				function(userDidCancel_orNil, existingPassword)
				{
					if (userDidCancel_orNil === true) {
						self.unguard_getNewOrExistingPassword()
						return // just silently exit after unguarding
					}
					if (self.password !== existingPassword) {
						self.unguard_getNewOrExistingPassword()
						const errStr = "Incorrect password"
						const err = new Error(errStr)
						self.emit(self.EventName_errorWhileChangingPassword(), err)
						return
					}
					// passwords match checked as necessary, we can proceed
					self.obtainNewPasswordFromUser(isForChangePassword)
				}
			)
		})
	}


	////////////////////////////////////////////////////////////////////////////////
	// Runtime - Imperatives - Private - Requesting password from user

	unguard_getNewOrExistingPassword()
	{
		const self = this
		self.isAlreadyGettingExistingOrNewPWFromUser = false
	}
	_getUserToEnterTheirExistingPassword(
		isForChangePassword, 
		fn // (userDidCancel_orNil?, existingPassword?) -> Void
	)
	{
		const self = this
		self.emit(
			self.EventName_SingleObserver_getUserToEnterExistingPasswordWithCB(), 
			isForChangePassword,
			function(userDidCancel_orNil, obtainedPasswordString) // we don't have them pass back the type because that will already be known by self
			{ // we're passing a function that the single observer should call
				if (userDidCancel_orNil) {
					// console.info("userDidCancel while having user enter their existing password")
				}
				fn(userDidCancel_orNil, obtainedPasswordString)
			}
		)
	}
	_getUserToEnterNewPassword(
		isForChangePassword,
		fn // (userDidCancel_orNil?, existingPassword?) -> Void
	)
	{
		const self = this
		self.emit(
			self.EventName_SingleObserver_getUserToEnterNewPasswordAndTypeWithCB(), 
			isForChangePassword,
			function(userDidCancel_orNil, obtainedPasswordString, userSelectedTypeOfPassword)
			{ // we're passing a function that the single observer should call
				// if (userDidCancel_orNil) {
				// }
				fn(userDidCancel_orNil, obtainedPasswordString, userSelectedTypeOfPassword)
			}
		)
	}


	////////////////////////////////////////////////////////////////////////////////
	// Runtime - Imperatives - Private - Setting/changing Password
	
	obtainNewPasswordFromUser(isForChangePassword)
	{
		const self = this
		const wasFirstSetOfPasswordAtRuntime = self.HasUserEnteredValidPasswordYet() === false // it's ok if we derive this here instead of in obtainNewPasswordFromUser because this fn will only be called, if setting the pw for the first time, if we have not yet accepted a valid PW yet		
		//
		self._getUserToEnterNewPassword(
			isForChangePassword,
			function(userDidCancel_orNil, obtainedPasswordString, userSelectedTypeOfPassword)
			{
				if (userDidCancel_orNil === true) {
					self.unguard_getNewOrExistingPassword()
					return // just silently exit after unguarding
				}
				//
				// I. Validate features of pw before trying and accepting
				if (userSelectedTypeOfPassword === self.AvailableUserSelectableTypesOfPassword().SixCharPIN) {
					if (obtainedPasswordString.length != 6) { // this is too short. get back to them with a validation err by re-entering obtainPasswordFromUser_cb
						self.unguard_getNewOrExistingPassword()
						const err = new Error("Please enter a 6-digit PIN.")
						self.emit(self.EventName_ErroredWhileSettingNewPassword(), err)
						return // bail 
					}
					// TODO: check if all numbers
					// TODO: check that numbers are not all just one number
				} else if (userSelectedTypeOfPassword === self.AvailableUserSelectableTypesOfPassword().FreeformStringPW) {
					if (obtainedPasswordString.length < 6) { // this is too short. get back to them with a validation err by re-entering obtainPasswordFromUser_cb
						self.unguard_getNewOrExistingPassword()
						const err = new Error("Please enter a longer password.")
						self.emit(self.EventName_ErroredWhileSettingNewPassword(), err)
						return // bail 
					}
					// TODO: check if password content too weak?
				} else { // this is weird - code fault or cracking attempt?
					self.unguard_getNewOrExistingPassword()
					const err = new Error("Unrecognized password type")
					throw err
					self.emit(self.EventName_ErroredWhileSettingNewPassword(), err)
					return
				}
				if (isForChangePassword === true) {
					if (self.password === obtainedPasswordString) { // they are disallowed from using change pw to enter the same pw… despite that being convenient for dev ;)
						self.unguard_getNewOrExistingPassword()
						
						var err;
						if (userSelectedTypeOfPassword === self.AvailableUserSelectableTypesOfPassword().FreeformStringPW) {
							err = new Error("Please enter a fresh password.")
						} else if (userSelectedTypeOfPassword === self.AvailableUserSelectableTypesOfPassword().SixCharPIN) {
							err = new Error("Please enter a fresh PIN.")
						} else { 
							self.unguard_getNewOrExistingPassword()
							const err = new Error("Unrecognized password type")
							throw err
							self.emit(self.EventName_ErroredWhileSettingNewPassword(), err)
							return
						}
						self.emit(self.EventName_ErroredWhileSettingNewPassword(), err)
						return // bail 
					}
				}
				//
				// II. hang onto new pw, pw type, and state(s)
				console.log("💬  Obtained " + userSelectedTypeOfPassword + " '" + obtainedPasswordString + "'")
				self._didObtainPassword(
					obtainedPasswordString,
					function(err)
					{
						if (err) {
							self.unguard_getNewOrExistingPassword()
							self.password = undefined // they'll have to try again
							self.emit(self.EventName_ErroredWhileSettingNewPassword(), err)
							return
						}
						self.userSelectedTypeOfPassword = userSelectedTypeOfPassword
						//
						// III. finally, save doc so we know a pw has been entered once before
						self.saveToDisk(
							function(err)
							{
								if (err) {
									self.unguard_getNewOrExistingPassword()
									self.password = undefined // they'll have to try again
									self.emit(self.EventName_ErroredWhileSettingNewPassword(), err)
									return
								}
								self.unguard_getNewOrExistingPassword()
								{ // detecting & emiting first set or change
									if (wasFirstSetOfPasswordAtRuntime === true) {
										self.emit(self.EventName_SetFirstPasswordDuringThisRuntime(), self.password, self.userSelectedTypeOfPassword)
									} else {
										self.emit(self.EventName_ChangedPassword(), self.password, self.userSelectedTypeOfPassword)
									}
								}
								{ // general purpose emit
									self.emit(self.EventName_ObtainedNewPassword(), self.password, self.userSelectedTypeOfPassword)
								}
							}
						)
					}
				) // save to self and flip state
			}
		)
	}


	////////////////////////////////////////////////////////////////////////////////
	// Runtime - Imperatives - Private - Deferring until booted

	_executeWhenBooted(fn)
	{
		const self = this
		if (self.hasBooted === false) {
			// console.log("Deferring execution of function until booted.")
			setTimeout(function()
			{
				self._executeWhenBooted(fn)
			}, 50) // ms
			return
		}
		fn() // ready to execute
	}


	////////////////////////////////////////////////////////////////////////////////
	// Runtime - Imperatives - Private - Persistence

	saveToDisk(fn)
	{
		const self = this
		console.log("📝  Saving password model to disk.")
		//
		if (self.password === null || typeof self.password === 'undefined') {
			const errStr = "Code fault: saveToDisk musn't be called until a password has been set"
			console.error(errStr)
			throw errStr
			fn(new Error(errStr))
			return
		}
		const encryptedMessageForUnlockChallenge = symmetric_string_cryptor.EncryptedBase64String__Async(
			plaintextMessageToSaveForUnlockChallenges,
			self.password,
			function(err, encryptedMessageForUnlockChallenge)
			{
				if (err) {
					console.error("Error while encrypting message for unlock challenge:", err)
					throw err
					fn(err)
				}
				self.encryptedMessageForUnlockChallenge = encryptedMessageForUnlockChallenge // it's important that we hang onto this in memory so we can access it if we need to change the password later
				const persistableDocument =
				{
					userSelectedTypeOfPassword: self.userSelectedTypeOfPassword,
					encryptedMessageForUnlockChallenge: self.encryptedMessageForUnlockChallenge
				}
				self._overridable_finalized_persistableDocument(
					persistableDocument, 
					function(err, finalized_persistableDocument)
					{
						if (err) {
							throw err
							fn(err)
							return
						}
						// console.log("modelObject" , modelObject)
						// insert & update fn declarations for imminent usage…
						if (self._id === null || typeof self._id === 'undefined') {
							_proceedTo_insertNewDocument(finalized_persistableDocument)
						} else {
							_proceedTo_updateExistingDocument(finalized_persistableDocument)
						}
					}
				)
			}
		)
		function _proceedTo_insertNewDocument(persistableDocument)
		{
			self.context.persister.InsertDocument(
				CollectionName,
				persistableDocument,
				function(
					err,
					newDocument
				)
				{
					if (err) {
						console.error("Error while saving password model:", err)
						fn(err)
						return
					}
					if (newDocument._id === null) { // not that this would happen…
						fn(new Error("Inserted password model but _id after saving was null"))
						return // bail
					}
					self._id = newDocument._id // so we have it in runtime memory now…
					console.log("✅  Saved newly inserted password model with _id " + self._id + ".")
					fn()
				}
			)
		}
		function _proceedTo_updateExistingDocument(persistableDocument)
		{
			var query =
			{
				_id: self._id // we want to update the existing one
			}
			var update = persistableDocument
			var options =
			{
				multi: false,
				upsert: false, // we are only using .update because we know the document exists
				returnUpdatedDocs: true
			}
			self.context.persister.UpdateDocuments(
				CollectionName,
				query,
				update,
				options,
				function(
					err,
					numAffected,
					affectedDocuments,
					upsert
				)
				{
					if (err) {
						console.error("Error while saving password model:", err)
						fn(err)
						return
					}
					var affectedDocument
					if (Array.isArray(affectedDocuments)) {
						affectedDocument = affectedDocuments[0]
					} else {
						affectedDocument = affectedDocuments
					}
					if (affectedDocument._id === null) { // not that this would happen…
						fn(new Error("Updated password model but _id after saving was null"))
						return // bail
					}
					if (affectedDocument._id !== self._id) {
						fn(new Error("Updated password model but _id after saving was not equal to non-null _id before saving"))
						return // bail
					}
					if (numAffected === 0) {
						fn(new Error("Number of documents affected by _id'd update was 0"))
						return // bail
					}
					console.log("✅  Saved update to password model with _id " + self._id + ".")
					fn()
				}
			)
		}
	}
	_overridable_finalized_persistableDocument(
		persistableDocument_in,
		fn // (err?, finalized_persistableDocument?) -> Void
	)
	{
		const finalized_persistableDocument = persistableDocument_in
		fn(null, finalized_persistableDocument) // no err
	}
	//
	//
	// Runtime - Delegation - Obtained password
	//
	_didObtainPassword(
		password, 
		fn // (err?) -> Void
	)
	{
		fn = fn || function(err){} 
		//
		const self = this
		const existing_hasUserEverEnteredPassword = self.hasUserEverEnteredPassword
		self.password = password
		self.hasUserEverEnteredPassword = true // we can now flip this to true
		//
		const waiting_passwordModel_doc = self._initial_waitingForFirstPWEntryDecode_passwordModel_doc
		if (typeof waiting_passwordModel_doc !== 'undefined' && waiting_passwordModel_doc !== null) {
			self._initial_waitingForFirstPWEntryDecode_passwordModel_doc = null // zero so we don't do this more than once
			//
			self._overridable_init_loadStateFromModel(
				waiting_passwordModel_doc,
				function(err)
				{
					fn(err)
				}
			)
		} else {
			fn() // no err, return immediately
		}
	}
	//
	//
	// Runtime - Imperatives - Delete everything
	//
	InitiateDeleteEverything(fn)
	{ // this is used as a central initiation/sync point for delete everything like user idle
	  // maybe it should be moved, maybe not.
		const self = this
		self._deconstructBootedStateAndClearPassword(
			function(cb)
			{
				console.log("now reset state…")
				// reset state cause we're going all the way back to pre-boot 
				self.hasBooted = false // require this pw controller to boot
				self.password = undefined // this is redundant but is here for clarity
				self.hasUserEverEnteredPassword = false
				self._id = undefined
				self.encryptedMessageForUnlockChallenge = undefined
				self._initial_waitingForFirstPWEntryDecode_passwordModel_doc = undefined
				//
				// delete pw record
				self.context.persister.RemoveDocuments(
					CollectionName, 
					{}, 
					{ multi: true }, 
					function(err, numRemoved)
					{ // now have others delete everything else
						if (err) {
							cb(err)
							return
						}
						console.log("🗑  Deleted password record.")
						async.each( // parallel; waits till all finished
							self.deleteEverythingRegistrants,
							function(registrant, registrant_cb)
							{
								registrant.passwordController_DeleteEverything(function(err)
								{
									registrant_cb(err)
								})
							},
							function(err)
							{
								if (err) {
									cb(err)
									return // will travel back to the 'throw' below
								}
								self.setupAndBoot() // now trigger a boot before we call cb (tho we could do it after - consumers will wait for boot)
								//
								cb(err)
							}
						)
					}
				)
			},
			function(err)
			{
				if (err) {
					fn(err)
					throw err
					return
				}
				self.emit(self.EventName_havingDeletedEverything_didDeconstructBootedStateAndClearPassword())
				fn(err)
				return
			}
		)
	}
	AddRegistrantForDeleteEverything(registrant)
	{
		const self = this
		// console.log("Adding registrant for 'DeleteEverything': ", registrant.constructor.name)
		self.deleteEverythingRegistrants.push(registrant)
	}
	_deconstructBootedStateAndClearPassword(
		hasFiredWill_fn, // (cb) -> Void; cb: (err?) -> Void
		fn
	)
	{
		hasFiredWill_fn = hasFiredWill_fn || function(cb) { cb() }
		fn = fn || function(err) {}
		//
		const self = this
		// TODO:? do we need to cancel any waiting functions here? not sure it would be possible to have any (unless code fault)…… we'd only deconstruct the booted state and pop the enter pw screen here if we had already booted before - which means there theoretically shouldn't be such waiting functions - so maybe assert that here - which requires hanging onto those functions somehow
		{ // indicate to consumers they should tear down and await the "did" event to re-request
			self.emit(self.EventName_willDeconstructBootedStateAndClearPassword())
		}
		setTimeout(function()
		{ // on next tick…
			hasFiredWill_fn(
				function(err)
				{
					if (err) {
						fn(err)
						return
					}
					{ // trigger deconstruction of booted state and require password
						self.password = undefined
					}
					{ // we're not going to call WhenBootedAndPasswordObtained_PasswordAndType because consumers will call it for us after they tear down their booted state with the "will" event and try to boot/decrypt again when they get this "did" event
						self.emit(self.EventName_didDeconstructBootedStateAndClearPassword())
					}
					fn()
				}
			)
		}, 2)
	}
	//
	//
	// Runtime - Delegation - User having become idle -> teardown booted state and require pw
	//
	_didBecomeIdleAfterHavingPreviouslyEnteredPassword()
	{
		const self = this
		self._deconstructBootedStateAndClearPassword()
	}	
	//
	//
	// Runtime - Delegation - Post-instantiation hook
	//
	RuntimeContext_postWholeContextInit_setup()
	{
		const self = this
		// We have to wait until post-whole-context-init to guarantee all controllers exist
		self._startObserving_userIdleInWindowController()
	}
}
module.exports = PasswordController
