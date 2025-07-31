import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { table } from "console";
import { application } from "express";
import jwt from "jsonwebtoken"

const generateAccessAndRefreshTokens = async( userId ) => {
    try {
        const user= await User.findById( userId )
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()

        user.refreshToken = refreshToken
        await user.save( { validateBeforeSave:false } )
        return { accessToken, refreshToken }
    } catch ( error ) {
        throw new ApiError( 500, "Something went wrong while generating access token and refresh token" )
    }
}

const registerUser = asyncHandler( async( req, res ) => {
    // get user details from frontend
    // validation - not empty
    // check user if already exist: username & email
    // check for images, check for avatar
    // upload them to cloudinary, avatar
    // create user object- create entry in db
    // remove password and refresh token field from response
    // check for user creation
    // return res

    const { fullName, username, email, password }= req.body
    console.log( "Email: ", email );

    if( [ fullName, username, email, password ].some( ( field )=> 
    field?.trim()==="" ) ) {
        throw new ApiError( 400, "All fields are required" )
    }
    
   const existedUser= await User.findOne( {
        $or: [ { username }, { email } ]
    } )
    if( existedUser ) {
        throw new ApiError( 409, "User is email or username already exists" )
    }
    console.log( req.files );
    const avatarLocalPath = req.files?.avatar[0]?.path;
    // const coverImageLocalPath = req.files?.coverImage[0]?.path;
    let coverImageLocalPath;
    if( req.files && Array.isArray( req.files.coverImage ) && req.files.coverImage.length>0 ){
        coverImageLocalPath=req.files.coverImage[0].path
    }

    if( !avatarLocalPath ) {
        throw new ApiError( 400, "avatar is required!!!" )
    }

    const avatar = await uploadOnCloudinary( avatarLocalPath )
    const coverImage = await uploadOnCloudinary( coverImageLocalPath )

    if( !avatar ){
        throw new ApiError( 400, "avatar is required!!!" )
    }

   const user= await User.create({
        fullName,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        password,
        username: username.toLowerCase()
    })

    const createdUser = await User.findById( user._id ).select(
        "-password -refreshToken"
    )

    if( !createdUser ){
        throw new ApiError( 500, "Something went wrong while registering user" )
    }

    return res.status( 201 ).json(
        new ApiResponse( 200, createdUser, "User registered successfully" )
    )
})

const loginUser = asyncHandler(async( req,res ) => {
    // req body -> data
    // 
    // validation from database
    // 

    const { username, email, password } =  req.body

    if( !username && !email ) {
        throw new ApiError( 400, "Username and email is required!!!" )
    }

    const user = await User.findOne({
        $or: [{ username }, { email }]
    })

    if( !user ){
        throw new ApiError( 404, "User doesn't exist!!!" )
    }

   const isPasswordValid = await user.isPasswordCorrect( password )

   if( !isPasswordValid ){
    throw new ApiError( 401,"Invalid user credentials" )
   }
   const { accessToken, refreshToken } = await generateAccessAndRefreshTokens( user._id )
   const loggedInUser = await User.findById( user._id ).select( "-password -refreshToken" )

   const options = {
    httpOnly: true,
    secure: true
   }

   return res
   .status( 200 )
   .cookie( "accessToken", accessToken )
   .cookie( "refreshToken", refreshToken )
   .json(
    new ApiResponse( 200, {
        user: loggedInUser, accessToken, refreshToken
    },
    "User logged In Successfully" )
   )
})

const logoutUser = asyncHandler( async( req,res ) => {
    User.findByIdAndUpdate( req.user._id,
        {
            $unset: {
                refreshToken: 1
            }
        },
        {
            new: true
        }
    )

    const options = {
        httpOnly: true,
        secure: true
    }

    return res
    .status( 200 )
    .clearCookie( "accessToken", options )
    .clearCookie ( "refreshToken  ", options )
    .json( new ApiResponse( 200, {}, "User Logged Out" ) )
})

const refreshAccessToken = asyncHandler( async( req, res ) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

    if( !incomingRefreshToken ){
        throw new ApiError( 401, "Unauthorized request" )
    }
    try {
        const decodedToken = jwt.verify( incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET )

        const user = await User.findById( decodedToken?._id )

        if( !user ){
            throw new ApiError( 401, "Invalid Refresh Token" )
        }

        if( incomingRefreshToken !== user?.refreshToken ){
            throw new ApiError( 401,"Refresh token is expired or used" )
        }

        const options = {
            httpOnly : true,
            secure : true
        }

        const { accessToken, newRefreshToken } = await generateAccessAndRefreshTokens( user._id )
         return res
   .status( 200 )
   .cookie( "accessToken", accessToken, options )
   .cookie( "refreshToken", newRefreshToken, options )
   .json(
    new ApiResponse( 200, {
        accessToken, refreshToken: newRefreshToken
    },
    "Access token refreshed" )
   )
    } catch ( error ) {
        throw new ApiError( 401, error?.message || "Invalid refresh token" )
    }
})

const changeCurrentPassword = asyncHandler( async( req, res) => {
    const {oldPassword, newPassword} = req.body

    const user = await User.findById(req.user?._id)
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)
    if( !isPasswordCorrect ){
        throw new ApiError( 400, "Invalid Old Password" )
    }

    user.password = newPassword
    await user.save({ validateBeforeSave:false })

    return res
    .status( 200 )
    .json( new ApiResponse( 200, {}, "Password Changed Successfully" ) )
})

const getCurrentUser = asyncHandler( async(req, res) => {
    return res
    .status( 200 )
    .json( 200, req.user, "Current User fetched successfully" )
})

const updateAccountDetails = asyncHandler( async (req, res) => {
    const {fullName, email} = req.body

    if( !fullName || !email ){
        throw new ApiError( 400, "All fields are required" )
    }

    const user = await User.findByIdAndUpdate(req.user?._id,
        {
            $set: {
                fullName,
                email
            }
        },
        {
            new: true
        }
    ).select("-password")

    return res
    .status( 200 )
    .json( new ApiResponse(200, user, "Account Updated Successfully" ) )
})

const updateUserAvatar = asyncHandler( async (req, res) => {
    const avatarLocalPath = req.file?.path

    if(!avatarLocalPath){
        throw new ApiError(400, "Avatar file is missing")
    }
    const avatar = await uploadOnCloudinary(avatarLocalPath)

    if(!avatar.url){
        throw new ApiError( 400, "Error while uploading avatar")
    }
    const user = await User.findByIdAndUpdate(req.user?._id,
        {
            $set: {
                avatar: avatar.url
            }
        },
        {
            new: true
        }
    ).select("-password")

    return res
    .status( 200 )
    .json( new ApiResponse(200, user, "Avatar Image Updated Successfully" ) )

})

const updateUserCoverImage = asyncHandler( async (req, res) => {
    const coverImageLocalPath = req.file?.path

    if(!coverImageLocalPath){
        throw new ApiError(400, "Avatar file is missing")
    }
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if(!coverImage.url){
        throw new ApiError( 400, "Error while uploading cover Image")
    }
    const user = await User.findByIdAndUpdate(req.user?._id,
        {
            $set: {
                coverImage: coverImage.url
            }
        },
        {
            new: true
        }
    ).select("-password")

    return res
    .status( 200 )
    .json( new ApiResponse(200, user, "Cover Image Updated Successfully" ) )

})

const getUserChannelProfile = asyncHandler( async(req, res) => {
    const {username} = req.params

    if(!username.trim()){
        throw new ApiError(400, "Username is missing")
    }

    const channel = await User.aggregate([
        {
            $match: {
                username: username?.toLowerCase()
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers"
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "subscriber",
                as: "subscribedTo"
            }
        },
        {
            $addFields: {
                subscribersCount: {
                    $size: "$subscribers"
                },
                channelSubscribedToCount: {
                    $size: "$subscribedTo"
                },
                isSubscribed: {
                    $cond: {
                        if: {$in: [req.user?._id, "$subscribers.subscriber"]},
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $project: {
                fullName: 1,
                username: 1,
                email: 1,
                avatar: 1,
                coverImage: 1,
                subscribersCount: 1,
                channelSubscribedToCount: 1
            }
        }
    ])

    if(!channel?.length){
        throw new ApiError(404, "Channel doesn't exist")
    }

    return res
    .status(200)
    .json(
        new ApiResponse(200, channel[0], "User channel fetched successfully")
    )
})
const getWatchHistory = asyncHandler( async( req, res ) => {
    const user = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.objectId( req.user._id )
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project: {
                                        fullName: 1,
                                        username: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields: {
                            owner: {
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        }
    ])
    return res
    .status( 200 )
    .json(
        new ApiResponse(
            200,
            user[0].watchHistory,
            "Watch history fetched successfully"
        )
    )
})
export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateUserAvatar,
    updateUserCoverImage,
    getUserChannelProfile,
    getWatchHistory
}